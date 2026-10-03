@echo off
setlocal
:: run from the project root whichever folder this was started from
cd /d "%~dp0"
:: Builds the exe and the command-line tool, then assembles the portable release:
::   release\Pixel to 3D Batch Builder\      (the folder that gets zipped)
::   release\Pixel to 3D Batch Builder.zip
:: The release goes to release\, not dist\: dist\ is Vite's build folder and Vite empties it on every build.
:: Don't run the program from inside release\ : its settings folder would be wiped by the next build.

set PROJECT_NAME=Pixel to 3D Batch Builder
set RELEASE_DIR=release\%PROJECT_NAME%

echo Building the command-line tool...
call npm run cli:build
if errorlevel 1 goto :failed

echo Building %PROJECT_NAME%...
call npm run desktop:build
if errorlevel 1 goto :failed

if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
if exist "release\%PROJECT_NAME%.zip" del "release\%PROJECT_NAME%.zip"
mkdir "%RELEASE_DIR%"

:: the program, and the folders it reads next to its exe
:: ask cargo where it builds: src-tauri\target\ normally, or a shared folder if target-dir is set in ~\.cargo\config.toml
set TARGET_DIR=
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "(cargo metadata --format-version 1 --no-deps --manifest-path src-tauri\Cargo.toml | ConvertFrom-Json).target_directory"`) do set "TARGET_DIR=%%T"
if not defined TARGET_DIR set "TARGET_DIR=src-tauri\target"
echo Taking the exe from %TARGET_DIR%\release
copy "%TARGET_DIR%\release\%PROJECT_NAME%.exe" "%RELEASE_DIR%\" >nul || goto :failed
xcopy /e /i /q "presets" "%RELEASE_DIR%\presets" >nul || goto :failed
xcopy /e /i /q "examples" "%RELEASE_DIR%\examples" >nul || goto :failed
xcopy /e /i /q "public\guide" "%RELEASE_DIR%\guide" >nul || goto :failed

:: the Godot preview project, without Godot's own cache (.godot) or any models dropped into models\ while testing
robocopy "godot-preview" "%RELEASE_DIR%\godot-preview" /e /xd ".godot" "models" /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto :failed
mkdir "%RELEASE_DIR%\godot-preview\models"
copy "godot-preview\models\README.txt" "%RELEASE_DIR%\godot-preview\models\" >nul || goto :failed
copy "godot-preview\models\.gdignore" "%RELEASE_DIR%\godot-preview\models\" >nul || goto :failed

:: the command-line tool finds presets\ one folder up from cli\
mkdir "%RELEASE_DIR%\cli"
copy "cli\p3d.mjs" "%RELEASE_DIR%\cli\" >nul || goto :failed

:: docs and promo
for %%F in (README.md LICENSE.md CLI.md promo.md) do copy "%%F" "%RELEASE_DIR%\" >nul || goto :failed
xcopy /e /i /q "promo" "%RELEASE_DIR%\promo" >nul || goto :failed

powershell -NoProfile -Command "Compress-Archive -Path '%RELEASE_DIR%' -DestinationPath 'release\%PROJECT_NAME%.zip' -Force"
if errorlevel 1 goto :failed

echo.
echo Done. Release folder: %RELEASE_DIR%
echo Zip: release\%PROJECT_NAME%.zip
if not "%1"=="nopause" pause
exit /b 0

:failed
echo.
echo Build failed, see the messages above.
if not "%1"=="nopause" pause
exit /b 1
