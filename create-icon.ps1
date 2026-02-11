Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

# Background circle - dark red
$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 30, 30))
$g.FillEllipse($bgBrush, 8, 8, 240, 240)

# Orange ring
$ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 140, 0)), 6
$g.DrawEllipse($ringPen, 8, 8, 240, 240)

# Radiation/nuke symbol - 3 sectors
$centerX = 128
$centerY = 128
$innerR = 30
$outerR = 90

$sectorBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 200, 0))

# Draw 3 radiation sectors at 0, 120, 240 degrees
foreach ($startAngle in @(-90, 30, 150)) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(($centerX - $outerR), ($centerY - $outerR), ($outerR * 2), ($outerR * 2), $startAngle, 60)
    $endAngle = $startAngle + 60
    $endRad = $endAngle * [Math]::PI / 180
    $startRad = $startAngle * [Math]::PI / 180
    $path.AddLine(
        ($centerX + $outerR * [Math]::Cos($endRad)),
        ($centerY + $outerR * [Math]::Sin($endRad)),
        ($centerX + $innerR * [Math]::Cos($endRad)),
        ($centerY + $innerR * [Math]::Sin($endRad))
    )
    $path.AddArc(($centerX - $innerR), ($centerY - $innerR), ($innerR * 2), ($innerR * 2), $endAngle, -60)
    $path.AddLine(
        ($centerX + $innerR * [Math]::Cos($startRad)),
        ($centerY + $innerR * [Math]::Sin($startRad)),
        ($centerX + $outerR * [Math]::Cos($startRad)),
        ($centerY + $outerR * [Math]::Sin($startRad))
    )
    $g.FillPath($sectorBrush, $path)
}

# Center dot
$dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 200, 0))
$g.FillEllipse($dotBrush, ($centerX - 12), ($centerY - 12), 24, 24)

# "MMX" text at bottom
$font = New-Object System.Drawing.Font ("Arial", 28, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'
$sf.LineAlignment = 'Center'
$g.DrawString("MMX", $font, $textBrush, $centerX, 215, $sf)

$g.Dispose()

# Save as ICO
$icoPath = Join-Path $PSScriptRoot "nuke.ico"
$ms = New-Object System.IO.MemoryStream

# ICO header
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([Int16]0)      # reserved
$bw.Write([Int16]1)      # type: icon
$bw.Write([Int16]1)      # count

# PNG data
$pngMs = New-Object System.IO.MemoryStream
$bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
$pngData = $pngMs.ToArray()

# ICO directory entry
$bw.Write([byte]0)       # width (0 = 256)
$bw.Write([byte]0)       # height (0 = 256)
$bw.Write([byte]0)       # color palette
$bw.Write([byte]0)       # reserved
$bw.Write([Int16]1)      # color planes
$bw.Write([Int16]32)     # bits per pixel
$bw.Write([Int32]$pngData.Length) # image size
$bw.Write([Int32]22)     # offset to image data

# Image data
$bw.Write($pngData)
$bw.Flush()

[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())

$bmp.Dispose()
$pngMs.Dispose()
$ms.Dispose()

Write-Host "Icon created at: $icoPath"
