Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Paths
desktopPath = WshShell.SpecialFolders("Desktop")
projectPath = fso.GetParentFolderName(WScript.ScriptFullName)
shortcutPath = desktopPath & "\MMX NUKE.lnk"
batchPath = projectPath & "\start-poller.bat"
iconPath = projectPath & "\nuke.ico"

' Create shortcut
Set shortcut = WshShell.CreateShortcut(shortcutPath)
shortcut.TargetPath = batchPath
shortcut.WorkingDirectory = projectPath
shortcut.Description = "Launch MMX Auto Poller"
shortcut.WindowStyle = 1

' Use custom icon if exists, otherwise use explosion-like system icon
If fso.FileExists(iconPath) Then
    shortcut.IconLocation = iconPath
Else
    ' Shell32.dll icon 240 = shield/warning icon (closest to "nuke" in system icons)
    shortcut.IconLocation = "shell32.dll,240"
End If

shortcut.Save

WScript.Echo "Desktop shortcut 'MMX NUKE' created!"
