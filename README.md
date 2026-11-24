# MagiCP Discord Bot

Bot di Magistri Competitive Programming per la verifica dei membri del server Discord.
Raccoglie le candidature, permette allo staff di valutarle e assegna i ruoli scelti.
Il pannello web gestisce canali, ruoli e messaggio di verifica.

## Training Olinfo su Discord

- `/stats [username]` mostra punti, problemi risolti, sottoposizioni e tempo di esecuzione del profilo pubblico.
- `/problem difficolta:<1–10> [username]` estrae un problema della difficoltà scelta. Con uno username esplicito o associato, esclude i problemi già completati a punteggio pieno.
- `/link username:<username>` salva il profilo da usare quando ometti lo username. Puoi aggiornare l’associazione ripetendo il comando. L’associazione è una preferenza del bot e non assegna ruoli o permessi.

Il bot registra i comandi all’avvio sul server indicato da `DISCORD_GUILD_ID`.
