@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo  BA-DIAN 离线蒙特卡洛模拟 - 一键启动
echo  流程：正确性闸门 -^> 自动基准 -^> 全量 -^> 报告
echo ============================================

if not exist "node\node.exe" (
  echo [错误] 未找到便携 node.exe。请把本 zip 完整解压到一个目录。
  pause
  exit /b 1
)
if not exist "sim\sim.js" (
  echo [错误] 未找到 sim\sim.js。请完整解压运行包。
  pause
  exit /b 1
)

set NODE=node\node.exe
set OUT=results
if not exist "%OUT%" mkdir "%OUT%"

echo.
echo [1/3] 正确性闸门（1000 局 + 144 共享用例 + 位级重放）
"%NODE%" sim\verify.js
if errorlevel 1 (
  echo [错误] 正确性闸门未通过，终止运行。
  pause
  exit /b 1
)

echo.
echo [2/3] 全量实验（默认 60 分钟；如需调整，改用下方自定义命令）
echo       自定义示例：%NODE% sim\sim.js --duration 900 --workers 11 --out results
"%NODE%" sim\sim.js --experiment all --duration 3600 --out "%OUT%"

echo.
echo [3/3] 完成。结果目录：%CD%\%OUT%
echo   summary.json / balance.csv / matchups.csv
echo   failures.jsonl / benchmark.json / experiment-config.json / report.html
if exist "%OUT%\report.html" start "" "%OUT%\report.html"
pause
