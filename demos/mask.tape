Output "mask.gif"
Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 520
Set FontFamily "Menlo"
Set Padding 10
Set TypingSpeed 28ms
Hide
Type "source env.sh"
Enter
Sleep 300ms
Type "cd $MASK_DIR; PS1='$ '; clear"
Enter
Show
Sleep 400ms
Type "cat fake.env"
Enter
Sleep 1800ms
Type "pixi"
Enter
Sleep 6s
Type "read fake.env"
Enter
Sleep 13s
Ctrl+O
Sleep 3s
