@echo off
echo.
echo ========================================
echo   4FUN Marketing - Dashboard de Clientes
echo   Setup inicial
echo ========================================
echo.

echo [1/4] Instalando dependencias do Worker (API)...
cd worker
call npm install
cd ..

echo.
echo [2/4] Instalando dependencias do Frontend...
cd frontend
call npm install
cd ..

echo.
echo [3/4] Instalando dependencias dos Scripts...
cd scripts
call npm install
cd ..

echo.
echo [4/4] Pronto!
echo.
echo Proximos passos:
echo   1. Faca login no Cloudflare: wrangler login
echo   2. Siga as instrucoes do README.md para criar D1, KV e R2
echo   3. Copie seu logo para: frontend\public\logo-4fun.png
echo.
echo Para rodar localmente:
echo   Terminal 1: cd worker  ^&^& npm run dev
echo   Terminal 2: cd frontend ^&^& npm run dev
echo.
pause
