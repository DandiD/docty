# Icona

`icon.svg` è la sorgente. I PNG che Chrome carica si rigenerano da lì con il browser
stesso, senza dipendenze:

```bash
./extension/icons/build.sh
```

La funzione, non il gesto: la bolla è l'assistente in pagina, i due contatti sopra sono
le funzioni che il sito espone — il connettore che le rende invocabili — e i tre fori
sono la conversazione.

Fondo trasparente e un solo colore, l'accento del progetto (`#4fb3ae`). I punti sono
ritagliati invece che dipinti di scuro: così la bolla si legge sia su una barra chiara
sia su una scura, senza sapere in anticipo quale sarà.
