# 성과보고서 docx를 Word로 PDF로 렌더하고 쪽수를 확인한다(통합 레드팀 17라운드: 16라운드 문구 수정으로 2장을 넘겼는데 쪽수 검사가 없었다).
# 사용: powershell -NoProfile -File tools/render_report.ps1 <docx 절대경로> <pdf 절대경로>
# 기준: 총 3쪽(보고서 2쪽 + 양식에 딸린 참가신청서 1쪽), 보고서 표가 2쪽에서 끝남. 아니면 종료 코드 1.
param([Parameter(Mandatory = $true)][string]$in, [Parameter(Mandatory = $true)][string]$out)
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
$code = 1
try {
  $doc = $w.Documents.Open($in, $false, $true)
  $pages = $doc.ComputeStatistics(2)
  $t = $doc.Tables.Item(1)
  $endPage = $t.Range.Characters.Last.Information(3)
  $doc.SaveAs2($out, 17)
  $doc.Close($false)
  "pages: $pages, report table ends on page: $endPage"
  if ($pages -eq 3 -and $endPage -eq 2) { $code = 0 } else { "FAIL: 총 3쪽·보고서 2쪽 기준을 넘음" }
} finally { $w.Quit() }
exit $code
