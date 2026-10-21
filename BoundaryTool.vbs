' Launch PowerShell directly, without cmd.exe or a visible console.
Option Explicit
Dim shell, fs, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
scriptPath = fs.BuildPath(fs.GetParentFolderName(WScript.ScriptFullName), "Start-BoundaryTool.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"
If WScript.Arguments.Count > 0 Then
    If WScript.Arguments(0) = "--no-browser" Then command = command & " -NoBrowser"
End If
shell.Run command, 0, False
