@echo off
chcp 65001 >nul 2>&1

:: 检查是否以管理员身份运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    :: 不是管理员，用 UAC 提权重新启动自己
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

:: 以管理员身份运行 PowerShell 脚本
powershell -ExecutionPolicy Bypass -File "%~dp0lock-jianying-59.ps1"

if %errorlevel% equ 0 (
    echo.
    echo =====================
    echo.
    echo       成 功 !
    echo.
    echo  剪映已锁定为5.9版本
    echo.
    echo =====================
    echo.
) else (
    echo.
    echo  运行出错，请联系技术支持
    echo.
)

pause
