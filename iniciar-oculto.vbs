' Sobe o Correiatendimentos sem nenhuma janela visivel.
'
' O VBScript ja vem no Windows, entao nao depende de instalar nada. Ele chama o
' servidor-oculto.cmd com estilo de janela 0 (escondida) e sem esperar terminar,
' de modo que o servidor fica rodando de fundo, sem a janela preta na tela.
'
' A guarda de instancia unica do servidor cuida do caso de rodar duas vezes: o
' segundo simplesmente avisa que ja esta no ar e sai.

Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)

Set sh = CreateObject("WScript.Shell")
sh.Run """" & pasta & "\servidor-oculto.cmd""", 0, False
