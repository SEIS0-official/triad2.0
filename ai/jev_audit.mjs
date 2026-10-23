#!/usr/bin/env node
// jev_audit.mjs — TypeSafe / Jev audit runner for the Triad repository.
//
// Zero dependencies (Node >= 18 for global fetch). Reads the repo, builds one
// System One state per file, asks Jev a typed question suite, and aggregates the
// answers into an error count.
//
//   node ai/jev_audit.mjs sweep --dry-run     # emit the exact JSON payloads, no API calls
//   node ai/jev_audit.mjs sweep                # call the API and write ai/jev_audit_report.md
//   node ai/jev_audit.mjs locate ai/SYSTEM_PROMPT.md   # locate defects by line window
//
// Auth:   Authorization: Bearer $TYPESAFE_API_KEY
// Model:  $TYPESAFE_MODEL (default "jev-latest")
//
// Design notes are in ai/jev_prompt.md. The short version: Jev is a judgment
// model, not a code reader, so "how many errors are in this project" is not one
// question -- it is one judgment per file, aggregated in code.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.TYPESAFE_MODEL || "jev-latest";
const API_KEY = process.env.TYPESAFE_API_KEY || "";

// ---------------------------------------------------------------------------
// 1. File inventory: which files matter, and what contract each one must meet.
// ---------------------------------------------------------------------------

// Roles drive the `contract` field of the state. A judgment is only meaningful
// if the model knows what the artifact was supposed to do in the first place.
const ROLE_RULES = [
  [/^SPEC(-CORE)?\.md$/, "spec", "The normative specification of Triad. Every rule it states must be implementable and must match what the reference implementation actually does. A rule that the implementation contradicts, or a rule that cannot be satisfied, is a defect."],
  [/^triad\.jl$/, "reference-implementation", "The reference implementation of the Triad-Core subset. It must implement the normative specification, expose exactly the command-line flags the specification lists, and follow the documented exit-code contract: 0 on success, non-zero on an unhandled error, 2 on a usage error."],
  [/^syntax\.jl$/, "reference-implementation", "The lexer and parser. It must accept every program that the normative specification declares well-formed, reject malformed programs with a diagnostic, and must not silently misparse."],
  [/^test\//, "test", "A unit test. It must assert observable behaviour of the implementation, it must fail when the behaviour breaks, and it must not encode a buggy behaviour as the expected result."],
  [/^conformance\/.*expected\.(out|code)$/, "golden", "A conformance golden. It must be exactly what a spec-conformant implementation of the Triad-Core subset produces, byte for byte, including the exit code. A golden that records buggy behaviour is a defect."],
  [/^conformance\/.*(program\.td|README\.md)$/, "test", "A conformance case. It must exercise the feature it claims to cover and must remain inside the Triad-Core subset."],
  [/^bin\//, "launcher", "A launcher script. It must locate the Triad runtime, forward its arguments unchanged, and behave identically to its sibling launcher for the same platform family. It must not depend on a path that only exists on the maintainer's machine."],
  [/^\.github\/workflows\//, "ci", "A CI workflow. It must gate exactly what the project claims to gate, on the platforms it claims to cover, using the same comparison rules as the local test suites."],
  [/^ai\/SYSTEM_PROMPT\.md$/, "prompt", "The system prompt handed to a code-generating model. It must accurately describe the runtime that will actually execute and verify the generated program, including the exact text that `println` produces for each value type. Any inaccuracy here produces solutions that can never match their golden."],
  [/^ai\/verify\.jl$/, "tooling", "The task verifier. It must compare a candidate program against the task golden under the same rules the conformance runner uses, and it must report failures rather than silently passing them."],
  [/^ai\/tasks\/.*expected\.out$/, "golden", "The golden output of a benchmark task. It must be exactly what the verifier produces for a correct solution, and the task statement beside it must describe it accurately."],
  [/^ai\/tasks\/.*task\.md$/, "prompt", "A benchmark task statement. It must describe a program that stays inside the Triad-Core subset that the verifier can actually run, and its stated expected output must match the task's golden."],
  [/^editors\//, "tooling", "An editor integration. It must declare the file extensions the language actually owns, and must not claim an extension that belongs to another language."],
  [/^seed\//, "tooling", "The seed bootstrap artifacts. The documented byte sizes, hashes and supported features must match the actual committed bytes and the actual behaviour of the decoded executable."],
  [/\.md$/, "doc", "Project documentation. Every factual claim it makes about the Triad implementation, the test suites, the conformance counts, the exit codes and the supported features must be true. A claim that a reader could act on and be wrong is a defect."],
  [/\.(jl|triad|td)$/, "source", "Source code. It must behave as the normative specification requires for the feature it implements."],
];

function roleFor(path) {
  for (const [re, role, contract] of ROLE_RULES) if (re.test(path)) return { role, contract };
  return { role: "source", contract: "The artifact must behave as the normative specification requires for the feature it implements." };
}

// Only text artifacts are sent to the model.
const TEXT_EXT = new Set([
  ".md", ".jl", ".yml", ".yaml", ".json", ".td", ".triad", ".cmd", ".vim",
  ".hex", ".txt", ".out", ".code", ".vsix", "",
]);
const SKIP_NAMES = new Set(["seed.exe", "seed", "triad-native.exe", "triad-native"]);

// The audit covers the files the project actually ships, i.e. the ones tracked
// by git. Untracked scratch files in the working tree are not artifacts.
async function trackedFiles() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 24 });
  const out = [];
  for (const rel of stdout.split("\0")) {
    if (!rel) continue;
    const base = rel.split("/").pop();
    if (SKIP_NAMES.has(base)) continue;
    if (!TEXT_EXT.has(extname(rel))) continue;
    out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Ground truth gathered locally, injected into the state as `known_facts`.
//    The model cannot execute the project; these are the facts it must not
//    contradict, and they tell it that a defect claim has to survive a green
//    test suite.
// ---------------------------------------------------------------------------

async function readIfExists(path) {
  try { return await readFile(join(ROOT, path), "utf8"); } catch { return ""; }
}

// Flags that belong to other tools and must not be mistaken for Triad CLI flags.
const FOREIGN_FLAGS = new Set([
  "--startup-file", // julia
  "--update", // conformance/run.jl
  "--project",
  "--color",
  "--depwarn",
  "--compiled-modules",
  "--check-bounds",
]);

async function extractCliFlags() {
  const triad = await readIfExists("triad.jl");

  // Flags the interpreter itself accepts: the `withargs` dictionary plus the
  // special-cased single flags in the argument loop.
  const implemented = new Set();
  const withargs = triad.match(/withargs\s*=\s*Dict\(([\s\S]*?)\)\s*\n/);
  if (withargs) for (const m of withargs[1].matchAll(/"(--?[A-Za-z][\w-]*)"/g)) implemented.add(m[1]);
  for (const m of triad.matchAll(/a in \(([^)]*)\)/g)) {
    for (const f of m[1].matchAll(/"(--?[A-Za-z][\w-]*)"/g)) implemented.add(f[1]);
  }

  // Flags the launcher scripts accept (a separate CLI surface from the interpreter).
  const launcher = new Set();
  for (const p of ["bin/triad", "bin/triad.cmd"]) {
    const txt = await readIfExists(p);
    for (const m of txt.matchAll(/(--[A-Za-z][\w-]+)/g)) {
      if (!FOREIGN_FLAGS.has(m[1])) launcher.add(m[1]);
    }
  }

  // Flags the documentation claims exist.
  const documented = new Set();
  for (const doc of ["README.md", "SPEC.md", "SPEC-CORE.md"]) {
    const txt = await readIfExists(doc);
    for (const m of txt.matchAll(/`?(--[A-Za-z][\w-]+)`?/g)) {
      if (!FOREIGN_FLAGS.has(m[1])) documented.add(m[1]);
    }
  }

  return {
    interpreter_implemented: [...implemented].sort(),
    launcher_implemented: [...launcher].sort(),
    claimed_by_docs: [...documented].sort(),
  };
}

async function knownFacts() {
  const flags = await extractCliFlags();
  return {
    local_suite_results: {
      note: "Results of the project's own suites on this machine. A defect claim must survive these being green, i.e. it must concern behaviour the suites do not cover, or a contradiction between the artifacts themselves.",
      verified_on: "2026-10-23",
      unit_tests: "261/261 passed",
      conformance_triad_full: "12/12 passed",
      conformance_triad_core: "29/29 passed",
      examples: "7/7 run with exit 0",
      windows_seed_cases: "not run locally; the Windows CI lane is configured but its hosted result was not checked",
    },
    cli_flags: {
      note:
        "Three different CLI surfaces. The interpreter (triad.jl) accepts interpreter_implemented; the launcher scripts (bin/triad, bin/triad.cmd) accept launcher_implemented; the documentation claims claimed_by_docs. A flag claimed by the docs that is in neither implemented list is a candidate defect, as is a documented flag that the interpreter does not actually accept.",
      interpreter_implemented: flags.interpreter_implemented,
      launcher_implemented: flags.launcher_implemented,
      claimed_by_docs: flags.claimed_by_docs,
    },
    observed_runtime_behaviour: [
      "println of a lambda prints '#lambda(x)', not 'fun'.",
      "println of a named function prints '#function <name>'.",
      "println of a symbol prints the symbol text without a leading colon.",
      "println of a list prints it in Triad list syntax.",
      "The builtin string(x) exists and is implemented in triad.jl; string(42) prints 42, string(:a) prints a.",
      "The keyword elseif is implemented and works.",
      "triad <missing-file> exits 1; triad -l <missing-file> exits 0.",
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. The question suite. Same names in the request and the answer.
// ---------------------------------------------------------------------------

const QUESTIONS = {
  has_defect: {
    type: "noul",
    instructions:
      "Does `content` contain at least one defect? A defect is: a statement in the text that is false about the Triad implementation; code that contradicts its contract; a broken path, link or file reference; or a declared value (byte size, hash, count, flag, exit code) that does not match reality. " +
      "Ignore style, wording, formatting preferences and missing optional features. Do not report a defect that `known_facts` already shows to be correct.",
    criteria: {
      true: "There is at least one concrete, verifiable defect in this artifact.",
      false: "The artifact is internally consistent and consistent with the contract and the known facts.",
    },
  },

  defect_class: {
    type: "choice",
    instructions: "What is the single most serious defect in this artifact? If there is none, choose none.",
    criteria: {
      none: "No defect was found in this artifact.",
      runtime_bug: "The implementation computes, returns or prints the wrong result.",
      exit_code_contract: "The process exit status violates the documented exit-code contract.",
      spec_mismatch: "The implementation or the text contradicts the normative specification.",
      false_documentation: "The text asserts something about the implementation that is not true.",
      stale_claim: "A status, coverage, count or roadmap statement is out of date with respect to the code.",
      broken_reference: "A relative link, file path, file name or command reference does not resolve to something that exists.",
      portability: "A script or workflow depends on one platform, one shell, or a path that exists only on one machine.",
      build_ci: "A build or CI workflow fails to exercise, or fails to gate, what the project claims it gates.",
      coverage_gap: "A documented feature has no test and no conformance case.",
      prompt_mismatch: "An AI prompt or benchmark task describes the runtime inaccurately, so correct generated solutions can never pass.",
      other: "A defect that does not fit any of the other categories.",
    },
  },

  severity: {
    type: "score",
    instructions: "How severe is the most serious defect in this artifact?",
    criteria: [
      "No defect, or purely cosmetic formatting that misleads no reader.",
      "The defect is inaccurate or stale documentation; a reader is not led to break anything.",
      "The defect breaks a documented contract, workflow or promise; the reader is led to a wrong action or a failed command.",
      "The defect causes a crash, a wrong computed result, a silently corrupted artifact, or a false pass in CI.",
    ],
  },

  defect_count: {
    type: "score",
    instructions: "How many distinct, independently fixable defects does this artifact contain?",
    criteria: [
      "No defects.",
      "Exactly one defect.",
      "Two distinct defects.",
      "Three or more distinct defects.",
    ],
  },

  caught_by_suite: {
    type: "noul",
    instructions:
      "Is the most serious defect in this artifact one that the project's own test suite and conformance suite would detect? " +
      "A defect in a document, a prompt, a launcher, or a CI workflow is normally NOT detected by them.",
    criteria: {
      true: "The existing test or conformance suite would fail because of this defect.",
      false: "The existing suite stays green with this defect present.",
    },
  },
};

// ---------------------------------------------------------------------------
// 4. Request construction and transport.
// ---------------------------------------------------------------------------

function buildState(path, content, facts) {
  const { role, contract } = roleFor(path);
  const lines = content.split("\n").length;
  return {
    project: {
      name: "Triad",
      summary:
        "Triad is a small programming language implemented in Julia. The repository contains the normative specification (SPEC.md, SPEC-CORE.md), the reference implementation (triad.jl, syntax.jl), a unit test suite, a conformance suite with byte-exact goldens, shell and cmd launchers, a CI workflow, a CI bootstrap seed written in raw machine code, editor integrations, and an AI benchmark harness.",
    },
    file: { path, role, lines },
    contract,
    known_facts: facts,
    content,
  };
}

async function callSystemOne(state, questions, { longContext = true } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
  if (longContext) headers["TypeSafe-Danger-Zone-Long-Context"] = "true";
  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${text}`);
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// 5. Sweep: one request per file, aggregated into a count.
// ---------------------------------------------------------------------------

async function sweep({ dryRun }) {
  const files = (await trackedFiles()).sort();
  const facts = await knownFacts();
  const results = [];

  for (const path of files) {
    const content = await readFile(join(ROOT, path), "utf8");
    const state = buildState(path, content, facts);
    const payload = { model: MODEL, state, questions: QUESTIONS };

    if (dryRun) {
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }

    try {
      const res = await callSystemOne(state, QUESTIONS);
      const a = res.answers;
      results.push({
        path,
        role: state.file.role,
        has_defect: a.has_defect?.noul ?? null,
        defect_class: a.defect_class?.choice ?? null,
        defect_confidence: a.defect_class?.confidence ?? null,
        severity: a.severity?.score ?? null,
        severity_confidence: a.severity?.confidence ?? null,
        defect_count: a.defect_count?.score ?? null,
        count_probs: a.defect_count?.probabilities ?? null,
        caught_by_suite: a.caught_by_suite?.noul ?? null,
        usage: res.usage,
      });
      process.stderr.write(`\r  ${results.length}/${files.length} ${path}`);
    } catch (err) {
      results.push({ path, role: state.file.role, error: String(err.message ?? err) });
      process.stderr.write(`\r  ${results.length}/${files.length} ${path}  ERROR`);
    }
  }

  if (dryRun) return;
  process.stderr.write("\n");
  await writeReport(results, files.length);
}

// Expected defect count from the Score distribution: level index is the count
// bucket, weighted by its probability. The model never counts; the code does.
function expectedCount(probs) {
  if (!probs) return null;
  const weights = { "0": 0, "1": 1, "2": 2, "3": 3 };
  let total = 0;
  for (const [k, p] of Object.entries(probs)) total += (weights[k] ?? 0) * p;
  return total;
}

async function writeReport(results, totalFiles) {
  const flagged = results.filter((r) => (r.has_defect ?? 0) >= 0.5);
  const unseen = flagged.filter((r) => r.caught_by_suite === false);
  const byClass = {};
  for (const r of flagged) byClass[r.defect_class] = (byClass[r.defect_class] ?? 0) + 1;

  const totalExpected = results.reduce((s, r) => s + (expectedCount(r.count_probs) ?? 0), 0);

  const lines = [];
  lines.push("# Jev audit report", "");
  lines.push(`Model: \`${MODEL}\`  |  files audited: ${totalFiles}  |  files flagged: ${flagged.length}`, "");
  lines.push(`**Estimated defect count (sum of per-file expected counts): ${totalExpected.toFixed(1)}**`, "");
  lines.push(`Flagged defects the existing test suite would NOT catch: ${unseen.length}`, "");
  lines.push("## Flagged files", "");
  lines.push("| file | role | P(defect) | class | severity | expected count | caught by suite |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of flagged.sort((a, b) => (b.has_defect ?? 0) - (a.has_defect ?? 0))) {
    lines.push(
      `| \`${r.path}\` | ${r.role} | ${(r.has_defect ?? 0).toFixed(2)} | ${r.defect_class} | ${r.severity ?? "-"} | ${(expectedCount(r.count_probs) ?? 0).toFixed(1)} | ${r.caught_by_suite === false ? "no" : "yes"} |`
    );
  }
  lines.push("", "## Defects by class", "");
  for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${v}`);
  lines.push("", "## Usage", "");
  const inTok = results.reduce((s, r) => s + (r.usage?.input_tokens ?? 0), 0);
  const outTok = results.reduce((s, r) => s + (r.usage?.output_tokens ?? 0), 0);
  lines.push(`input_tokens: ${inTok}  |  output_tokens: ${outTok}`);

  await writeFile(join(ROOT, "ai", "jev_audit_report.md"), lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// 6. Locate: split a flagged file into windows and ask which window is wrong.
//    Jev selects a window; the code turns the window into a line range.
// ---------------------------------------------------------------------------

const WINDOW_LINES = 40;

async function locate(path, { dryRun }) {
  const content = await readFile(join(ROOT, path), "utf8");
  const facts = await knownFacts();
  const all = content.split("\n");
  const { role, contract } = roleFor(path);

  for (let start = 0; start < all.length; start += WINDOW_LINES) {
    const chunk = all.slice(start, start + WINDOW_LINES).join("\n");
    const state = {
      project: { name: "Triad" },
      file: { path, role, window_start_line: start + 1, window_end_line: start + WINDOW_LINES },
      contract,
      known_facts: facts,
      content: chunk,
    };
    const questions = {
      defect_here: {
        type: "noul",
        instructions: "Does this window of the file contain a defect? A defect is a statement false about the Triad implementation, code contradicting its contract, or a broken path/link reference.",
        criteria: {
          true: "This window contains at least one concrete defect.",
          false: "This window is free of defects.",
        },
      },
      defect_class: {
        type: "choice",
        instructions: "What is the defect in this window? If there is none, choose none.",
        criteria: {
          none: "No defect in this window.",
          runtime_bug: "Wrong computed or printed result.",
          exit_code_contract: "Exit status violates the documented contract.",
          spec_mismatch: "Contradicts the normative specification.",
          false_documentation: "States something untrue about the implementation.",
          stale_claim: "Out-of-date status, count or roadmap statement.",
          broken_reference: "A link, path or file name that does not resolve.",
          portability: "Depends on one platform, shell, or local machine path.",
          build_ci: "CI does not exercise or gate what it claims.",
          coverage_gap: "A documented feature with no test.",
          prompt_mismatch: "An AI prompt or task describes the runtime inaccurately.",
          other: "None of the above.",
        },
      },
    };

    if (dryRun) {
      console.log(JSON.stringify({ model: MODEL, state, questions }, null, 2));
      continue;
    }
    const res = await callSystemOne(state, questions);
    const p = res.answers.defect_here?.noul ?? 0;
    if (p >= 0.5) {
      console.log(
        `${path}:${start + 1}-${start + WINDOW_LINES}  P=${p.toFixed(2)}  class=${res.answers.defect_class?.choice}  conf=${res.answers.defect_class?.confidence}`
      );
    }
  }
}

// ---------------------------------------------------------------------------

const cmd = process.argv[2];
const rest = process.argv.slice(3);
const dryRun = rest.includes("--dry-run");

if (cmd !== "sweep" && cmd !== "locate") {
  console.error("usage: node ai/jev_audit.mjs sweep [--dry-run]");
  console.error("       node ai/jev_audit.mjs locate <file> [--dry-run]");
  process.exit(2);
}

if (cmd === "sweep") {
  if (!dryRun && !API_KEY) {
    console.error("TYPESAFE_API_KEY is not set. Use --dry-run to print the payloads without calling the API.");
    process.exit(2);
  }
  await sweep({ dryRun });
} else {
  const target = rest.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("usage: node ai/jev_audit.mjs locate <file> [--dry-run]");
    process.exit(2);
  }
  if (!dryRun && !API_KEY) {
    console.error("TYPESAFE_API_KEY is not set. Use --dry-run to print the payloads without calling the API.");
    process.exit(2);
  }
  await locate(target, { dryRun });
}
