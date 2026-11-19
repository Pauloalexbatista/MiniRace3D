@echo off
cd /d "%~dp0"
echo Iniciando o MINIRACE 3D...
if not exist node_modules call npm install
echo Abrindo o navegador...
start http://localhost:5173
call npm run dev