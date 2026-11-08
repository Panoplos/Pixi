Output "prefix.gif"
Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 300
Set FontFamily "Menlo"
Set Padding 10
Set TypingSpeed 25ms
Hide
Type "source env.sh"
Enter
Sleep 300ms
Type "cd $PREFIX_DIR; rm -rf .pi; mkdir -p .pi; PS1='$ '; clear"
Enter
Show
Sleep 400ms
Type "pixi"
Enter
Sleep 6s
Type "/quit"
Enter
Sleep 2s
Type "clear"
Enter
Sleep 1s
Type "cat $DEMO_ROOT/prefix.json"
Enter
Sleep 1500ms
Type "cp $DEMO_ROOT/prefix.json .pi/settings.json"
Enter
Sleep 1s
Type "pixi"
Enter
Sleep 6s
Type "the input prefix is a setting"
Sleep 2500ms
