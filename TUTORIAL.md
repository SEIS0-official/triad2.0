# Triad 2.0 — Tutorial completo d'uso e programmazione

**Triad** è un linguaggio di programmazione autonomo: la sua definizione è lo standard
normativo in [`SPEC.md`](SPEC.md) (0.2.0), indipendente dall'implementazione.
L'implementazione di riferimento attuale è scritta in Julia per il bootstrap (`triad.jl`,
`syntax.jl`) e sarà sostituita da un'implementazione self-hosted ([`BOOTSTRAP.md`](BOOTSTRAP.md));
il linguaggio non dipende da Julia.

L'estensione canonica dei sorgenti è `.triad`; negli esempi trovi anche `.td`, accettata
come alias storico. La conformità è verificata da [`conformance/`](conformance/README.md).

Questo tutorial copre: installazione/avvio, CLI e REPL, sintassi, funzioni e multiple dispatch, struct, logica (fatti/regole/solve), errori come dati, contratti, budget, tracce, effetti dichiarati, macro e codice come dato, e la **destrutturazione** (aggiunta di recente).

---

## 1. Avvio e riga di comando

Dalla cartella del progetto:

```sh
julia triad.jl                   # REPL
julia triad.jl file.td a b       # esegue file.td, ARGS == ["a", "b"]
julia triad.jl -l file.td        # carica file e apre il REPL
julia triad.jl -i file.td        # esegue file e poi apre il REPL
julia triad.jl --tree file.td    # stampa albero uniforme (S-expression)
julia triad.jl -e 'codice'       # esegue una stringa
julia triad.jl -E 'codice'       # esegue e stampa il valore
julia triad.jl --help            # tutte le opzioni
julia triad.jl --version
```

Launcher (se `bin/` è nel `PATH`): `triad`, `triad.cmd` (Windows).
Il launcher POSIX cerca `TRIAD_JULIA`, poi `julia` nel `PATH` e infine alcune posizioni
standard Linux/macOS/WSL. Il launcher Windows cerca `TRIAD_JULIA`, poi Julia nel `PATH`
(ignorando l'alias di `WindowsApps`) e infine le installazioni Windows standard. Esempio:

```sh
triad examples/assaggio.td      # esegue assaggio.td
triad -E '1 + 2'                # stampa 3
triad -l famiglia               # carica famiglia.td e apre il REPL (senza .td)
```

L'estensione `.td` si può omettere (`famiglia` trova `famiglia.td`). `-` come script legge da stdin.
Codici di uscita: `0` ok, `1` errore non gestito, `2` riga di comando non valida.

---

## 2. REPL (stile Prolog)

```
triad> 1 + 2
3
triad> ?- parent(:tom, ?d)       query Prolog
?d = :bob ;
?d = :liz.
triad> fact x(1)                 definisce un fatto
triad> :listing                  mostra la knowledge base
triad> :load file                carica un file (.td si ometto)
triad> :reload / :make           ricarica da zero i file caricati
triad> :reset                    mondo vuoto
triad> :tree codice              mostra l'albero S-expression
triad> :help / :h                aiuto
triad> :quit / :q / :exit        esce
```

Regole REPL:
- I blocchi aperti con `function`/`struct`/`macro`/`if`/… restano in attesa finché non chiudi con `end`.
- `?- goal` (o un goal su predicati della KB) risolve e mostra le soluzioni una alla volta.
- Dopo ogni soluzione: `;`/`n`/spazio = successiva, `a` = tutte le rimanenti, invio/`.`/`c` = ferma.
- `false.` = nessuna soluzione.

---

## 3. Lessico (regole fondamentali)

| Elemento | Forma | Esempi |
|---|---|---|
| Identificatore | lettera o `_`, poi lettere/cifre/`_`; `!` finale ammesso se non seguito da `=` | `x`, `push!`, `età` |
| Variabile logica | `?` attaccato al nome | `?x`, `?who` |
| Variabile anonima | `?_` (ogni occorrenza è una variabile nuova) | `parent(?x, ?_)` |
| Simbolo | `:` + nome o operatore | `:alice`, `:+`, `:<=` |
| Numeri | `Int` (`42`, `1_000`) e `Float` (`3.14`, `1e-9`) | |
| Stringhe | `"..."` con escape `\n \t \" \\ \$` e interpolazione `$x`, `$(espr)` | `"x = $x"` |
| Commenti | `#` fino a fine riga; `#= … =#` multilinea | |
| Separatori | a capo o `;` | |
| Macro | `@nome(...)` | `@unless(c, e)` |

**Parole chiave:** `function struct macro end if elseif else for in while let begin return
break continue fact rule solve quote try catch with requires ensures true false nothing isa is`.
Contestuali dopo `solve`: `limit depth steps trace`.

**Regola dei due punti `:`:**
- `1:n` / `xs[2:end]`: `:` attaccato a un valore senza spazi → range.
- `f(:a)`, `x = :a`: `:` non preceduto da valore + nome → simbolo.
- `:( … )`: codice quotato.
- `c ? a : b`: `:` circondato da spazi → separatore ternario.

**Regola del `?`:** `?x` attaccato = variabile logica; `? ` con spazio = ternario.

Gli a capo chiudono un'istruzione, tranne dentro `( )`, `[ ]` e `:( )`, e tranne subito dopo un operatore binario o virgola di `rule`.

---

## 4. Valori e tipi

| Tipo | Valori |
|---|---|
| `Int`, `Float` (<: `Number`) | `42`, `3.5` |
| `Bool` | `true`, `false` |
| `String` | `"testo"` |
| `Symbol` | `:alice` (atomo logico) |
| `Nothing` | `nothing` |
| `List` | `[1, :a, "x"]` (indici da 1, come Julia) |
| `Function` | lambda, generiche, builtin |
| `Expr` | codice quotato (`Node`) |
| `Term`, `Cons` | termini e pattern lista logici |
| `Solution` | `{who = :dave}` |
| `Err` | errore come dato |
| `Type` | `typeof(3) == Int` |
| struct utente | `Point(3.0, 4.0)` |

Tutto è un'espressione con un valore. `if`, `let`, `try`, `with`, `solve` e i blocchi restituiscono il valore dell'ultima istruzione (`nothing` se none).

---

## 5. Variabili, assegnamento e scope

```julia
x = 42
y = x * 2           # assegnamento semplice
```

- `function`, lambda, `let`, `for`, `while` e comprehension creano uno scope.
- Dentro una funzione, l'assegnamento crea/modifica locali e chiusure, non i globali.
- Al top level, i cicli possono aggiornare i globali.
- `return`, `break`, `continue` come in Julia.

Assegnamento con tipo:
```julia
x::Int = 5
x = 6          # bene
x = 5.5        # Err(:type): il nome ha mantenuto il tipo dichiarato
y::Float = 1.0
y = 2          # 2.0, la conversione Int → Float è quella di Julia
```
Il vincolo nasce con la dichiarazione e vive nell'ambiente dove il nome è stato creato:
un `let x = ...` interno o un nome mai dichiarato tipato restano liberi (SPEC §4).

---

## 6. Funzioni e multiple dispatch

Forma breve:
```julia
sq(x) = x * x
area(n::Number) = :number
area(n::Int) = :int
area(p::Point) = :point
```

Forma blocco:
```julia
function dist(a::Point, b::Point)::Float
    requires a.x != b.x || a.y != b.y
    sqrt((a.x - b.x)^2 + (a.y - b.y)^2)
end
```

Operatori ridefinibili (sono funzioni):
```julia
function +(a::Point, b::Point)
    Point(a.x + b.x, a.y + b.y)
end
```

Regole di dispatch:
- Vince il metodo più specifico tra gli applicabili.
- Nessun metodo applicabile → `Err(:method)` (o fallback builtin per operatori numerici).
- Più metodi massimali → `Err(:ambiguous)`.
- Tipo di ritorno `::R` controllato all'uscita (conversione Int→Float).
- Funzioni e operatori sono valori di prima classe: `reduce(+, xs)`, `map(sq, xs)`.
- Lambda: `x -> x + 1` (chiusure).

Esempio completo:
```julia
f(n) = n < 2 ? n : f(n - 1) + f(n - 2)
f(10)   # 55
```

---

## 7. Strutture dati (struct)

```julia
struct Point
    x::Float
    y::Float
end
```

- Immutabili, costruttore posizionale `Point(3, 4)`.
- Campi tipizzati, `Int`→`Float` convertito come in Julia.
- Campo inesistente → `Err(:field)`.
- Tipo sbagliato → `Err(:type)`.
- `typeof(p) == Point`, `p isa Point`.

Accesso campi: `p.x`. Indexing liste: `xs[i]`, `xs[end]`, `xs[2:end]`.

---

## 8. Controllo di flusso

```julia
if condizione
    # ramo vero
elseif altra
    # ramo alternativo
else
    # ramo else
end

x > 2 ? :grande : :piccolo        # ternario

while condizione
    # corpo
end

for v in iterabile
    # corpo
end

let a = 1, b = 2
    a + b
end

begin
    stmt1
    stmt2
end
```

`try b catch e h end` / `try b end` (l'errore diventa il valore).
`requires c` (al top level = asserzione) e `ensures c` (solo dentro `function`).

---

## 9. Liste e collezioni

```julia
[1, 2, 3]           // lista
[h | t]             // pattern lista (testa | coda), solo in logica
[x for x in xs if x > 1]   // comprehension
```

Builtin liste: `length`, `isempty`, `first`, `last`, `rest`, `reverse`, `sort`, `sum`,
`push!`, `pop!`, `append!`, `vcat`, `collect`, `a:b` (range), `x in xs`.

---

## 10. Logica: fatti, regole, solve

Fatti:
```julia
fact parent(:alice, :bob)
fact parent(:alice, :carol)
fact parent(:bob, :dave)
```

Regole:
```julia
rule grandparent(?x, ?z) :- parent(?x, ?y), parent(?y, ?z)
rule ancestor(?a, ?d) :- parent(?a, ?d)
rule ancestor(?a, ?d) :- parent(?a, ?x), ancestor(?x, ?d)
```

`solve` restituisce una **lista di `Solution`** (valore normale, non stampa nulla):
```julia
sols = solve grandparent(:alice, ?who) limit 5
[s.who for s in sols]
[s.d for s in solve ancestor(:alice, ?d)]
```

Opzioni `solve`: `limit n`, `depth d`, `steps s`, `trace`.

Predicato usato come funzione (Bool):
```julia
grandparent(:alice, :erin)   # true
parent(:dave, :alice)        # false
if grandparent(:alice, ?x)   # usa come condizione
```

Goal supportati: `p(t…)`, `g1 && g2`, `(g1, g2)`, `g1 \|\| g2`, `!g`/`not(g)`, `a = b` (unificazione),
`?y is espr`, confronti, funzione Triad che restituisce Bool, `true`/`false`.

Variabili logiche: `?x` (attaccate), `?anon` (anonima, fresca). Occurs-check attivo:
`solve ?x = f(?x)` → nessuna soluzione.

`vars(s)` restituisce i nomi delle variabili legate in una `Solution`.

---

## 11. DESTRUTTURAZIONE (nuova)

Triad supporta la destrutturazione basata su **pattern di lista** (stile Prolog), con arità esatta.

### 10.1 Assegnamento multipla `(a, b) = expr`

Le parentesi sono **obbligatorie** attorno al pattern di destinazione. La lista di destra deve avere esattamente tanti elementi quanti sono le variabili.

```julia
(a, b) = [1, 2]
a   # 1
b   # 2
[a, b]   # [1, 2]
```

Mismatch di arità → `Err(:bounds)`:
```julia
e = try (a, b) = [1] end      # troppi pochi elementi
e.kind   # :bounds

e = try (a, b) = [1, 2, 3] end   # troppi elementi
e.kind   # :bounds
```

### 10.2 `for` destrutturato `for (k, v) in xs`

`xs` deve essere una lista di liste; ogni elemento viene scomposto in `k` e `v`.

```julia
xs = []
for (k, v) in [[1, 2], [3, 4]]
    push!(xs, [k, v])
end
xs   # [[1, 2], [3, 4]]
```

Se un elemento non è una lista o ha arità diversa → `Err(:bounds)` o `Err(:type)`.

### 10.3 Parametri destrutturati `f((a, b))`

Scrivendo `(a, b)` come parametri si definiscono **due parametri separati** `a` e `b` (già il comportamento normale di Triad, i parametri sono appiattiti):

```julia
function f((a, b))
    a + b
end
f(10, 20)   # 30

mk = (a, b) -> a + b
mk(10, 20)  # 30
```

Nota: per destrutturare **un singolo argomento lista** in più variabili, usa l'assegnamento dentro il corpo:
```julia
function f(pair)
    (a, b) = pair
    a + b
end
f([10, 20])   # 30
```

---

## 12. Errori come dati

Un errore è un valore `Err(kind, msg, data)`. Non solleva eccezioni Julia, salvo non gestito al top level.

```julia
e = try 1 / 0 end        # Float division: Inf (come Julia), non errore
e = try div(1, 0) end    # Err(:domain, ...)
e.kind                   # :domain
e.msg

iserr(e)                 # true/false
throw(err(:mio, "ops", 42))
err(:kind, "messaggio"[, dati])
error("boom")            # Err(:error, ...)
```

`try b end` (senza catch): l'errore diventa il valore dell'espressione.
`try b catch e h end`: `e` è l'Err, si valuta `h`.

Kinds: `:syntax`, `:undef`, `:type`, `:method`, `:ambiguous`, `:field`, `:bounds`, `:domain`,
`:instantiation`, `:contract`, `:budget`, `:effect`, `:host`.

---

## 13. Contratti (`requires` / `ensures`)

```julia
function safe_div(a::Number, b::Number)::Float
    requires b != 0
    ensures abs(result * b - a) < 1e-9
    a / b
end

safe_div(6, 3)   # 2.0
try safe_div(1, 0) end   # Err(:contract, requires violata)
```

- `requires c`: controllata dove compare (inizio corpo, o top level = asserzione).
- `ensures c`: controllata all'uscita, `result` legato al valore restituito, dopo il check del tipo di ritorno.
- Violazione → `Err(:contract, …)` con `data.clause`, `data.fn`, `data.cond`, `data.result`.
- Contratti sono **puri**: un effetto dentro un contratto → `Err(:effect)`.
- `ensures` fuori da `function` → `Err(:syntax)`.

---

## 14. Budget

```julia
r = with budget(steps = 10_000)
    i = 0
    while true
        i += 1
    end
end
r.kind   # :budget (il ciclo infinito finisce con un Err, non si blocca)
```

- Un passo = chiamata, iterazione ciclo, passo di risoluzione.
- `with budget(steps = N) … end`: se esaurito, il valore del `with` è `Err(:budget)`.
- I budget si annidano: vale il più stretto. Solo il budget del `with` corrente diventa valore; quello esterno propaga.
- `solve … steps N` è il budget specifico di una query.
- Default solve steps: 1 000 000.

---

## 15. Tracce

La traccia è un **valore**, non output stampato.

```julia
fib(n::Int) = n < 2 ? n : fib(n - 1) + fib(n - 2)
t = with trace
    fib(3)
end
t.result     # 2
t.trace      # [Event(port=:call, fn=:fib, args=[3], depth=0), …]
t = solve path(:a, :c) trace
t.trace      # eventi porte Byrd (:call, :exit, :redo, :fail, :depth)
```

Eventi: record con `port`, `goal`/`fn`, `depth` (e `value`/`:args` per funzioni). Filtrabili come qualsiasi valore.

---

## 16. Effetti dichiarati

Funzioni pure di default. Effetti: `io` (`println`, `print`), `state` (`fact`/`rule` dentro funzione).

```julia
function saluta(nome::String) !io
    println("ciao, ", nome)
end

function impara(x) !state
    fact visto($x)
end
```

- Controllo dinamico: funzione pura che chiama `!io` o `println` → `Err(:effect)`.
- Top level permette tutti gli effetti.
- Lambda ereditano gli effetti del contesto.
- Macro e contratti puri.
- Leggere KB (`solve`, predicato) è puro.
- Mutazione locale (liste, variabili locali) non è effetto.

---

## 17. Macro e codice come dato (Lisp)

Il codice è un albero uniforme `Node(head, args)`.

```julia
c = :(a.x + f(b, 2))
c.head    # :call
c.args    # [...]
sexpr(c)  # "(call (dot a x) (call f b 2))"
```

`$(x)` / `$(espr)` inserisce valori nel codice quotato; `eval(c)` lo esegue.

```julia
n = 7
quadrato = :($n * $n)
eval(quadrato)   # 49
```

`parse(testo)` → albero; `unparse(albero)` → testo; `sexpr(albero)` → S-expression.
`Expr(:head, args…)` costruisce un Node.

Macro (ricevono codice, restituiscono codice, espansione pura non igienica):
```julia
macro unless(c, body)
    :(if !$c; $body; end)
end

macro swap(a, b)
    tmp = gensym(:tmp)
    quote
        $tmp = $a
        $a = $b
        $b = $tmp
    end
end

@swap(x, y)
@unless(x < y, println("x non è minore di y"))
```

`gensym()` genera nomi freschi per evitare catture. `eval(c)` esegue nello scope globale.

---

## 18. Builtin principali

Aritmetica/confronto: `+ - * / ^ % == != < <= > >= !`, `abs sqrt floor ceil round exp log sin cos div mod min max`.
Liste: `length isempty first last rest reverse sort sum push! pop! append! vcat collect`.
Ordine superiore: `map filter reduce any all count`.
Stringhe/output: `string repr println print`.
Tipi: `typeof isa Int Float String Symbol`.
Errori: `err iserr throw error`.
Codice: `eval parse unparse sexpr Expr gensym`.
Logica: `vars(sol)`.

---

## 19. Esempi pratici

### Esempio 1 — assaggio (tutti i paradigmi)
```julia
struct Point
    x::Float
    y::Float
end

function dist(a::Point, b::Point)::Float
    requires a.x != b.x || a.y != b.y
    sqrt((a.x - b.x)^2 + (a.y - b.y)^2)
end

fact parent(:alice, :bob)
fact parent(:bob, :dave)
rule grandparent(?x, ?z) :- parent(?x, ?y), parent(?y, ?z)

macro unless(c, body)
    :(if !$c; $body; end)
end

result = solve grandparent(:alice, ?who) limit 5
println("nipoti: ", result)
println("primo: ", result[1].who)

p = Point(0, 0)
q = Point(3, 4)
println("dist = ", dist(p, q))

e = try dist(p, p) end   # contratto violato -> Err
println(e.kind, ": ", e.msg)

@unless(length(result) == 0, println("almeno un nipote"))
println("nonna? ", grandparent(:alice, :dave))
```

### Esempio 2 — destrutturazione
```julia
# assegnamento multipla
(a, b) = [10, 20]
println("a = ", a, ", b = ", b)   # a = 10, b = 20

# for destrutturato
coppie = []
for (k, v) in [[1, 2], [3, 4], [5, 6]]
    push!(coppie, k + v)
end
println(coppie)   # [3, 7, 11]

# arità sbagliata -> Err(:bounds)
e = try (a, b) = [1] end
println(e.kind)   # :bounds
```

---

## 19.5 Esempi eseguibili con output reale

Questi esempi sono copiati da `examples/*.td` e da `test/runtests.jl`. L'output mostrato è quello **reale** prodotto da `julia --startup-file=no triad.jl <file>` (o equivalente).

### 19.5.1 assaggio.td — tutti i paradigmi (struct, logica, macro, contratti)

Comando:
```sh
julia --startup-file=no triad.jl examples/assaggio.td
```

Output:
```
nipoti di alice: [{who = :dave}]
primo: dave
quanti: 1
dist(p, q) = 5.0
dist(p, p) -> Err(:contract, "requires violata in dist: a.x != b.x || a.y != b.y", Info(fn = :dist, clause = :requires, cond = :(a.x != b.x || a.y != b.y)))
tipo: contract
almeno un nipote
alice è nonna di dave? true
```

### 19.5.2 famiglia.td — fatti, regole, ricorsione, liste, negazione

Comando:
```sh
julia --startup-file=no triad.jl examples/famiglia.td
```

Output:
```
discendenti di tom: [:bob, :liz, :ann, :pat, :jim]
fratelli di ann: [:pat]
madri: ["pat -> jim"]
senza figli: [:liz, :ann, :jim]
over 50: [:tom, :bob]
modi di spezzare [1, 2, 3]:
  [] ++ [1, 2, 3]
  [1] ++ [2, 3]
  [1, 2] ++ [3]
  [1, 2, 3] ++ []
figli di bob: [:ann, :pat]
```

### 19.5.3 garanzie.td — errori come dati, contratti, budget, tracce, effetti

Comando:
```sh
julia --startup-file=no triad.jl examples/garanzie.td
```

Output:
```
2.5
violazione: contract — requires violata in safe_div: b != 0
clausola: requires, funzione: safe_div
valore 5
errore domain: divisione intera per zero
valore 2
valore 42
errore input: età non valida
catturato mio con dati [1, 2, 3]
ciclo infinito -> budget
solve infinito -> budget
fib(3) = 2 in 10 eventi
chiamate: [[3], [2], [1], [0], [1]]
  call path(:a, :c) @0
  call edge(:a, :c) @1
  fail edge(:a, :c) @1
  redo path(:a, :c) @0
  call edge(:a, ?z#2007) @1
  exit edge(:a, :b) @1
  call path(:b, :c) @1
  call edge(:b, :c) @2
  exit edge(:b, :c) @2
  exit path(:b, :c) @1
  exit path(:a, :c) @0
  redo path(:b, :c) @1
  call edge(:b, ?z#2012) @2
  exit edge(:b, :c) @2
  call path(:c, :c) @2
  call edge(:c, :c) @3
  fail edge(:c, :c) @3
  redo edge(:c, ?z#2017) @3
  fail edge(:c, ?z#2017) @3
  redo edge(:a, ?z#2007) @1
  fail edge(:a, ?z#2007) @1
ciao, Triad
effetto non dichiarato -> println richiede !io ma rumorosa non lo dichiara
imparato: [:gatto]
```

### 19.5.4 macro.td — codice come dato, quote, eval, macro

Comando:
```sh
julia --startup-file=no triad.jl examples/macro.td
```

Output:
```
codice:  :(a.x + f(b, 2))
head:    call
args:    [:+, :(a.x), :(f(b, 2))]
sexpr:   (call + (dot a x) (call f b 2))
:(7 * 7) = 49
parse:   (if (call > x 0) (block (sym pos)) (block (sym neg)))
unparse: if x > 0; :pos; else; :neg; end
dopo @swap: x = 2, y = 1
x non è minore di y
somma -> 5050
polinomio: :(0 + 1 * x ^ 0 + 2 * x ^ 1 + 3 * x ^ 2)
p(2) = 17
```

### 19.5.5 Esempi dai test (test/runtests.jl)

Ogni riga sotto è un comando eseguibile con `julia --startup-file=no -e '<codice>'` e il valore restituito.

```julia
x = 2; y = x * 21; y           # 42
7 / 2                          # 3.5
"ab" * "cd"                    # "abcd"
s = 0; for i in 1:10; s += i; end; s   # 55
i = 0; while i < 5; i += 1; end; i     # 5
let a = 1, b = a + 1; a + b; end       # 3
if 1 > 2; :a; elseif 2 > 1; :b; else; :c; end   # :b
sq(x) = x * x; map(sq, [1, 2, 3])      # [1, 4, 9]
reduce(+, [1, 2, 3, 4])                # 10
filter(x -> x % 2 == 0, 1:6)           # [2, 4, 6]
[x^2 for x in 1:4 if x > 2]            # [9, 16]
xs = [1, 2, 3]; xs[end]                # 3
x = 3; x > 2 ? :big : :small           # :big
f(n) = n < 2 ? n : f(n - 1) + f(n - 2); f(10)   # 55
function fact_(n::Int)::Int
    if n <= 1; return 1; end
    n * fact_(n - 1)
end; fact_(10)                         # 3628800
```

---

## 20. Fix noti — prima/dopo (sezione §3 di HANDOFF-HERMES.md)

I sei fix seguenti sono già applicati a `triad.jl` e `syntax.jl`. Non modificare i file: questa sezione documenta solo il comportamento prima e dopo.

| # | Fix | Prima | Dopo |
|---|-----|-------|------|
| 1 | Round-trip range `1:n` | `unparse(1:n)` produceva `"1 : n"` (con spazi), che il lexer rifiuta (SPEC §2 vuole `a:b` senza spazi). | `unparse(1:n)` produce `"1:n"`, che round-trippa correttamente. |
| 2 | `unparse` totale per `:destructure` / `:dfor` | Cadevano nel fallback S-expression (`"(dfor (tuple k v) m (block k))"`). | Hanno i loro rami in `up` e round-trippano. |
| 3 | `xs[end] = v` / `xs[end] += 1` | `end` era legato solo in lettura → `Err(:undef, "'end' non è definito")`. | `assign!` lega `end = length(coll)` nell'ambiente dell'indice, quindi `xs[end] = 7` funziona. |
| 4 | Escape sconosciuti nelle stringhe | `"\r"` diventava `"arb"` (corruzione silenziosa di dati). | Il lexer accetta solo `\n \t \" \\ \$` (SPEC §1); qualunque altro escape solleva `Err(:syntax, "escape sconosciuto ...")` con riga e colonna. |
| 5 | Commenti `#=` annidati | Il lexer si fermava al primo `=#` (`#= a #= b =# c =#` si rompeva). | Il lexer conta la profondità; `#= a #= b =# c =#` funziona, e un `#=` non chiuso resta errore `incomplete`. |
| 6 | Lambda con parametri tipati | `function (x::Int) x end` usciva con una `MethodError` dell'host (`Err(:host)`). | `Lam` porta i `types`; `:lambda` usa `split_params`; `apply_lam` fa `conform`; tipo sconosciuto validato alla definizione, come `define_function`. |

### 20.1 Esempio — prima/dopo del fix 1 (range)

```julia
# Prima del fix: unparse(1:n) -> "1 : n"  (errore di parse se rilanciato)
# Dopo del fix:
unparse(parse_program("1:n"))   # "1:n"
```

### 20.2 Esempio — prima/dopo del fix 3 (xs[end] = v)

```julia
# Prima del fix: Err(:undef, "'end' non è definito")
# Dopo del fix:
xs = [1, 2, 3]
xs[end] = 7
xs   # [1, 2, 7]
```

### 20.3 Esempio — prima/dopo del fix 4 (escape sconosciuti)

```julia
# Prima del fix: "\r" -> "arb"  (corruzione silenziosa)
# Dopo del fix:
e = try "\r" end   # Err(:syntax, ...)
e.kind             # :syntax
e.data.line        # numero di riga
e.data.col         # numero di colonna
```

### 20.4 Esempio — prima/dopo del fix 5 (commenti #= annidati)

```julia
# Prima del fix: #= a #= b =# c =#  si rompeva al primo =#
# Dopo del fix:
#= esterno #= interno =# fine esterno =#   # valido, profondità contata
```

### 20.5 Esempio — prima/dopo del fix 6 (lambda tipate)

```julia
# Prima del fix: Err(:host) per MethodError
# Dopo del fix:
f = function (x::Int) x end
f(3)   # 3
f(2.0) # Err(:type): atteso Int, ricevuto Float
```

---


---


---

## 20. File e moduli

- `include("triad.jl")` da Julia, poi `w = Triad.World()`, `Triad.run_source(w, src)` (solleva `TriadError`) oppure `Triad.eval_source(w, src)` (restituisce sempre un valore, eventualmente `Err`).
- Test: `julia test/runtests.jl`.
- Esempi: `examples/assaggio.td`, `famiglia.td`, `garanzie.td`, `macro.td`.

---

## 21. Riferimento rapido sintassi

```
struttura:  struct Nome; x::T; y::T; end
funzione:   function f(a::T)::R !eff ... end
forma breve: f(x) = espr
lambda:     x -> x + 1
fatto:      fact p(:a, :b)
regola:     rule p(?x, ?y) :- q(?x), r(?y)
query:      solve p(?x) limit N depth D steps S trace
assegn:     x = espr
destruttur: (a, b) = [1, 2]      (parentesi obbligatorie)
for destr:  for (k, v) in [[1,2],[3,4]] ... end
cond:       if c ... elseif ... else ... end
cicli:      while c ... end / for v in it ... end
blocco:     let a = 1 ... end / begin ... end
try/catch:  try b catch e h end / try b end
contratto:  requires c / ensures c
budget:     with budget(steps = N) ... end
traccia:    with trace ... end / solve p trace
effetto:    function f() !io ... end
macro:      macro m(a) ... end / @m(e)
quote:      :(espr) / quote ... end / $espr
eval:       eval(codice)
```

---

# Parte 2 — Integrazione Julia, esempi avanzati, debug e glossario

## A. Usare Triad da Julia (API del kernel)

Il kernel è il modulo `Triad` in `triad.jl`. Da Julia:

```julia
include("triad.jl")
using .Triad

# Crea un mondo (ambiente di esecuzione) vuoto
w = Triad.World(out = IOBuffer())   # out: dove va println/print

# Esegue sorgente Triad; solleva TriadError in caso di errore non gestito
v = Triad.run_source(w, "x = 1 + 2; x")
# v == 3

# Esegue e restituisce SEMPRE un valore (Err in caso di errore)
r = Triad.eval_source(w, "nondefinito")
# r isa Triad.Err, r.kind == :undef

# Parsing indipendente
code, lines = Triad.parse_toplevel("x = 1")
# code è un Node(:block, [...]); lines i numeri di riga

# Albero -> testo / S-expression
Triad.unparse(code)
Triad.sexpr(code)
```

- `run_source` solleva `TriadError(err::Err)` quando c'è un errore non gestito nel programma.
- `eval_source` cattura tutto e restituisce l'`Err` (utile per test o REPL).
- `World(out = IOBuffer())` cattura l'output di `println`/`print` in un buffer.
- Il mondo porta lo stato: funzioni, struct, macro, fatti/regole della KB, variabili globali, budget, tracer.

## B. Esempi avanzati

### B.1 Fusione paradigma: funzione che consulta la KB
```julia
fact edge(:a, :b, 2)
fact edge(:b, :c, 3)
rule path(?x, ?y, ?c) :- edge(?x, ?y, ?c)
rule path(?x, ?y, ?c) :- edge(?x, ?z, ?c1), path(?z, ?y, ?c2), ?c is ?c1 + ?c2

(solve path(:a, :c, ?costo))[1].costo   # 5
```

### B.2 Lista in stile Prolog e `app`
```julia
rule app([], ?l, ?l)
rule app([?h | ?t], ?l, [?h | ?r]) :- app(?t, ?l, ?r)

(solve app([1, 2], [3], ?r))[1].r     # [1, 2, 3]
length(solve app(?a, ?b, [1, 2, 3]))  # 4 (4 modi di spezzare)
```

### B.3 Negazione per fallimento: foglie (nodi senza figli)
```julia
fact parent(:tom, :bob)
fact parent(:tom, :liz)
persone = [:tom, :bob, :liz]
foglie = filter(p -> !parent(p, ?_), persone)   # chi non è genitore
```

### B.4 Macro `time_it` che misura e stampa
```julia
macro time_it(label, e)
    :(begin
        r = $e
        println($label, " -> ", r)
        r
    end)
end

@time_it("somma", reduce(+, 1:100))   # stampa "somma -> 5050", restituisce 5050
```

### B.5 Polinomio costruito come albero (codice che genera codice)
```julia
function poly(coeffs)
    acc = :(0)
    i = 0
    for c in coeffs
        acc = :($acc + $c * x ^ $i)
        i += 1
    end
    acc
end

p = poly([1, 2, 3])     # albero: ((0) + 1 * x^0) + 2 * x^1 + 3 * x^2
x = 2
eval(p)                 # 17
```

### B.6 Errore come dato con dispatch
```julia
describe(e::Err) = string("errore ", e.kind, ": ", e.msg)
describe(x::Any) = string("valore ", x)

risultati = [try div(10, d) end for d in [2, 0, 5]]
for r in risultati
    println(describe(r))
end
```

### B.7 Contratti e budget insieme
```julia
function safe_div(a::Number, b::Number)::Float
    requires b != 0
    ensures abs(result * b - a) < 1e-9
    a / b
end

e = try safe_div(1, 0) end
e.kind          # :contract
e.data.clause   # :requires
e.data.fn       # :safe_div

r = with budget(steps = 1000)
    while true end
end
r.kind          # :budget
```

## C. Debug e risoluzione problemi comuni

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| `Err(:syntax)` con "atteso fine istruzione" | Manca `end` o `;`/a capo dopo un blocco | Aggiungi `end` o `;` |
| `Err(:undef)` su `nome` | Nome non definito (funzione, struct, predicato) | Definiscilo prima, o usa `:nome` per simbolo |
| `Err(:type)` in condizione `if` | Condizione non `Bool` (nessun "truthy" in Triad) | Usa `==`, `>`, ecc. che restituiscono `Bool` |
| `Err(:method)` su chiamata | Nessun metodo applicabile per quei tipi | Aggiungi metodo o usa tipi compatibili |
| `Err(:ambiguous)` | Più metodi ugualmente specifici | Ridisegna le firme per rimuovere l'ambiguità |
| `Err(:bounds)` in destrutturazione | Lista con arità diversa dal pattern | Usa liste di lunghezza esatta |
| `Err(:effect)` | Funzione `!io`/`!state` chiamata da pura | Aggiungi l'effetto alla firma del chiamante |
| `Err(:budget)` in `solve` | Troppi passi di risoluzione | Aumenta `steps` o aggiungi `limit`/`depth` |
| Ricorsione infinita si blocca | Triad usa stack esplicito, finisce in `:budget` | Non è stack overflow, è `Err(:budget)` |

Strumenti di debug:
- `triad.jl --tree file.td` — vedi l'albero uniforme (S-expression) per capire come il parser ha interpretato il codice.
- `sexpr(codice)` — stessa cosa dentro Triad.
- `unparse(albero)` — albero -> testo.
- `parse("testo")` -> albero.
- `with trace … end` — `t.trace` mostra eventi `:call`/`:exit` delle funzioni.
- `solve … trace` — `t.trace` mostra porte Byrd del motore logico.
- `try … end` — l'errore diventa valore, ispezionabile con `.kind`, `.msg`, `.data`.

## D. Glossario

- **Node**: l'unico tipo di albero di Triad (`head`, `args`). Codice e dati sono la stessa cosa.
- **Solution**: `{nome = valore, …}` restituita da `solve`; si accede con `s.nome` o `s[:nome]`.
- **Err**: errore come dato (`kind`, `msg`, `data`), mai eccezione Julia (salvo top level non gestito).
- **Traced**: `(result, trace)` restituito da `with trace` / `solve trace`.
- **solve**: motore logico SLD iterativo (nessuna ricorsione dell'host); restituisce lista di `Solution`.
- **Occurs-check**: l'unificazione rifiuta `?x = f(?x)` (nessuna soluzione, non ciclo infinito).
- **Multiple dispatch**: scelta del metodo più specifico tra gli applicabili.
- **Effetti dichiarati**: `!io`, `!state` nella firma; controllo dinamico.
- **Contratti**: `requires` (pre-condizione) / `ensures` (post-condizione con `result`).
- **Budget**: `with budget(steps = N)` limita i passi; esaurimento → `Err(:budget)` come valore.
- **Destrutturazione**: `(a, b) = lista` (parentesi obbligatorie, arità esatta), `for (k, v) in lista_di_liste`.
- **REPL**: `triad>` per codice, `?- goal` per query Prolog, comandi `:load`/`:reload`/`:listing`/`:tree`/`:reset`/`:help`/`:quit`.

## E. Stato e limiti noti (SPEC §15)

Non ancora implementati: argomenti con nome (tranne `budget(steps = …)`), struct mutabili/tipi parametrici, macro senza parentesi (`@m a b`), quote annidate multi-livello, cut di Prolog. Il controllo degli effetti è dinamico (non statico). La destrutturazione copre liste piatte con arità esatta; pattern annidati ricorsivi non sono ancora supportati.

---

## F. Test oracle — confronto con gli interpreti di riferimento

Triad include un harness di test oracle (`test/oracles/oracle_tests.jl`) che cross-checka il comportamento di Triad contro tre interpreti esterni, usati solo come riferimento (non modificati):

| Interprete | Percorso | Cosa viene testato |
|---|---|---|
| SWI-Prolog | `swipl` (PATH) | fatti, regole e query da `examples/famiglia.td` |
| SBCL | `sbcl` (PATH) | closure, lambda e ricorsione |
| Julia | `julia` (PATH) | multiple dispatch (`defmethod` equivalente) |

Per ogni interprete il harness genera il sorgente nativo equivalente (`.pl`, `.lisp`, `.jl`), lo esegue, normalizza l'output e lo confronta con l'output di Triad sullo stesso esempio.

Eseguire gli oracle test:

```sh
julia --startup-file=no test/oracles/oracle_tests.jl
```

Se uno degli interpreti non è disponibile, il relativo testset viene saltato (`@skip`).

---

### F.1 Passi manuali con gli oracoli

I comandi sotto possono essere eseguiti a mano per confrontare Triad con ciascun interprete.

#### SWI-Prolog (fatti e regole da famiglia.td)

File Prolog (`famiglia.pl`):
```
parent(tom, bob). parent(tom, liz). parent(bob, ann). parent(bob, pat). parent(pat, jim).
female(liz). female(ann). female(pat).
mother(M, C) :- parent(M, C), female(M).
ancestor(A, D) :- parent(A, D).
ancestor(A, D) :- parent(A, X), ancestor(X, D).
```

Comando per le madri:
```sh
swipl -s famiglia.pl -g "mother(M,C), format('~w,~w~n',[M,C]), fail; true." -t halt
```

Output atteso (stesso di Triad `solve mother(?m, ?c)` su `examples/famiglia.td`):
```
pat,jim
```

Comando per gli antenati di tom:
```sh
swipl -s famiglia.pl -g "ancestor(tom,D), format('~w~n',[D]), fail; true." -t halt
```

Output atteso (stesso di Triad `solve ancestor(:tom, ?d)`):
```
bob
liz
ann
pat
jim
```

#### SBCL via Portacle (closure, lambda, ricorsione)

File Lisp (`oracle.lisp`):
```lisp
(defun mk (a b) (+ a b))
(format t "~a~%" (mk 10 20))
(defun fattorial (n) (if (<= n 1) 1 (* n (fattorial (- n 1)))))
(format t "~a~%" (fattorial 10))
```

Comando (configurare `SBCL_HOME` solo se richiesto dalla propria installazione):
```sh
sbcl --noinform --load oracle.lisp
```

Output atteso (stesso di Triad `mk = (a, b) -> a + b` e `fattorial`):
```
30
3628800
```

#### Julia 1.13.1 (multiple dispatch)

File Julia (`oracle.jl`):
```julia
area(n::Number) = :number
area(n::Int) = :int
println(area(1))
println(area(1.5))
```

Comando:
```sh
julia --startup-file=no oracle.jl
```

Output atteso (stesso di Triad con le stesse definizioni):
```
:int
:number
```

---


---

Fine del tutorial.

---

Scritto e mantenuto da **Kilo** — agente software engineer per il progetto Triad 2.0.
Ultimo aggiornamento: include la destrutturazione (`(a, b) = lista`, `for (k, v) in lista_di_liste`, parametri `(a, b)`) e i test oracle.

