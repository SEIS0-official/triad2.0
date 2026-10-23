@echo off
rem =====================================================================
rem  triad.cmd — launcher Windows per il linguaggio Triad
rem
rem  Cerca un runtime Triad in questo ordine:
rem    1. bin\triad-native.exe  (eseguibile standalone)
rem    2. Variabile d'ambiente TRIAD_JULIA
rem    3. julia nel PATH
rem    4. Posizioni standard di Julia su Windows
rem
rem  Uso:  triad [opzioni] [file.td [argomenti...]]
rem        triad --help          tutte le opzioni
rem        triad --build         crea l'eseguibile standalone
rem
rem  Per usarlo da ovunque: aggiungere questa cartella al PATH.
rem =====================================================================

setlocal DisableDelayedExpansion

set "TRIAD_HOME=%~dp0.."

rem --- Modalità --build ------------------------------------------------
if "%~1"=="--build" goto :build

rem --- Ricerca del runtime ---------------------------------------------
set "RUNTIME="
set "JULIA="

rem 1. Eseguibile standalone
if exist "%TRIAD_HOME%\bin\triad-native.exe" (
    set "RUNTIME=standalone"
    goto :run
)

rem 2. Variabile d'ambiente TRIAD_JULIA
if defined TRIAD_JULIA (
    if exist "%TRIAD_JULIA%" (
        set "JULIA=%TRIAD_JULIA%"
        set "RUNTIME=julia"
        goto :run
    )
)

rem 3. PATH; ignore the Windows app-execution alias, which can shadow Julia.
for /f "delims=" %%J in ('where julia 2^>nul ^| findstr /i /v "WindowsApps"') do (
    if not defined JULIA set "JULIA=%%J"
)
if defined JULIA (
    set "RUNTIME=julia"
    goto :run
)

rem 4. Posizioni standard Windows
for %%d in (
    "%LOCALAPPDATA%\Programs\Julia-1.13.1\bin\julia.exe"
    "%LOCALAPPDATA%\Programs\Julia-1.12.0\bin\julia.exe"
    "%LOCALAPPDATA%\Programs\Julia-1.11.0\bin\julia.exe"
    "%LOCALAPPDATA%\Programs\Julia-1.10.0\bin\julia.exe"
    "%LOCALAPPDATA%\juliaup\bin\julia.exe"
    "%ProgramFiles%\Julia\bin\julia.exe"
    "C:\Julia\bin\julia.exe"
) do (
    if exist %%d (
        set "JULIA=%%~d"
        set "RUNTIME=julia"
        goto :run
    )
)

rem --- Nessun runtime trovato ------------------------------------------
echo triad: runtime non trovato. >&2
echo. >&2
echo Opzioni: >&2
echo   1. Crea uno standalone:   triad --build >&2
echo   2. Installa Julia e aggiungilo al PATH >&2
echo   3. Imposta TRIAD_JULIA=C:\path\to\julia.exe >&2
echo. >&2
echo Scarica Julia da https://julialang.org/downloads/ >&2
exit /b 1

rem --- Esecuzione ------------------------------------------------------
:run
if "%RUNTIME%"=="standalone" goto :run_standalone
if "%RUNTIME%"=="julia" goto :run_julia
exit /b 1

:run_standalone
"%TRIAD_HOME%\bin\triad-native.exe" %*
exit /b %errorlevel%

:run_julia
"%JULIA%" --startup-file=no "%TRIAD_HOME%\triad.jl" %*
exit /b %errorlevel%

:build
set "JULIA="
if defined TRIAD_JULIA set "JULIA=%TRIAD_JULIA%"
if not defined JULIA (
    for /f "delims=" %%J in ('where julia 2^>nul ^| findstr /i /v "WindowsApps"') do (
        if not defined JULIA set "JULIA=%%J"
    )
)
if not defined JULIA goto :build_not_found
echo ==^> Compilazione eseguibile standalone...
"%JULIA%" --startup-file=no "%TRIAD_HOME%\bin\build_standalone.jl" %*
exit /b %errorlevel%

:build_not_found
echo triad --build: Julia non trovato. Imposta TRIAD_JULIA o aggiungi julia al PATH. >&2
exit /b 2
