# Tat QuickEdit cua cua so cmd hien tai de bam chuot vao khong lam bot bi tam dung
$sig = @'
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int h);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
'@
$k = Add-Type -MemberDefinition $sig -Name ConsoleMode -Namespace Win -PassThru
$h = $k::GetStdHandle(-10)
$m = 0
if ($k::GetConsoleMode($h, [ref]$m)) {
  # 0x40 = QuickEdit, 0x80 = cho phep doi co mo rong
  [void]$k::SetConsoleMode($h, ($m -band (-bnot 0x40)) -bor 0x80)
}
