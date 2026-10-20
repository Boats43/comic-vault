# Pre-batch gate (read-only). Exit 0 = safe to start ONE sweep batch; non-zero = do not start.
param([int]$MinFreeMB = 3000, [int]$MaxCommitPct = 70)
$os = Get-CimInstance Win32_OperatingSystem
$freeMB = [int]($os.FreePhysicalMemory/1024)
$commitPct = [int]((($os.TotalVirtualMemorySize-$os.FreeVirtualMemory)/$os.TotalVirtualMemorySize)*100)
$mine = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*sweep2.mjs*' -or $_.CommandLine -like '*max-old-space-size=1024*')) -or ($_.Name -eq 'bash.exe' -and $_.CommandLine -like '*chain.sh') }
"freeMB=$freeMB (min $MinFreeMB)  commit=$commitPct% (max $MaxCommitPct)  myRunnersAlive=$(@($mine).Count)"
if (@($mine).Count -gt 0) { "BLOCK: a sweep runner/chain/test child is already alive"; $mine | ForEach-Object { "  PID $($_.ProcessId)" }; exit 3 }
if ($freeMB -lt $MinFreeMB) { "BLOCK: free physical memory below floor"; exit 2 }
if ($commitPct -gt $MaxCommitPct) { "BLOCK: commit charge above ceiling"; exit 2 }
"OK"; exit 0
