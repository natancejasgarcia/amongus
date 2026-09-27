# Among Us Web

Among Us multijugador en el navegador. Node.js + Socket.IO (servidor autoritativo) y Canvas con JS puro (sin build).

## Arrancar

```bash
npm install
npm start          # http://localhost:3000
```

La consola también muestra la IP de tu red local para jugar desde otros dispositivos de la misma WiFi.
Para probar con menos gente: `MIN_PLAYERS=2 npm start` (en PowerShell: `$env:MIN_PLAYERS=2; npm start`).

## Controles

| Tecla | Acción |
|---|---|
| WASD / flechas | Moverse (en móvil, joystick táctil) |
| E | Usar (tareas, botón de emergencia, reparar sabotajes, salir del conducto) |
| Q | Matar (impostor) |
| R | Reportar cuerpo |
| V | Entrar en conducto / saltar al siguiente (impostor) |
| M / Tab | Mapa |
| Esc | Cerrar minijuego o mapa |

## Qué incluye

- Salas con código de 4 letras y enlace para invitar (`?sala=CODE`), hasta 12 jugadores.
- Lobby con selección de color, chat y ajustes del anfitrión (impostores, enfriamiento, tiempos, nº de tareas).
- 12 salas y 14 tareas con 4 minijuegos (cables, números, descarga, calibrar).
- Impostor: matar con enfriamiento, conductos, sabotaje de luces (reduce la visión) y de reactor (dos jugadores a la vez o ganan los impostores).
- Reportar cuerpos, botón de emergencia (1 por jugador), reuniones con chat, votación, omitir y pantalla de expulsión.
- Fantasmas: atraviesan paredes, siguen haciendo tareas y tienen su propio chat.
- Victoria por tareas, por expulsar a los impostores, por paridad o por fusión del reactor.

## Estructura

```
server.js          lógica de partida, validación de movimiento y acciones (20 Hz)
shared/map.js      mapa, colisiones, tareas, conductos (lo usan servidor y cliente)
public/client.js   red, entrada, HUD, reuniones
public/render.js   dibujo en canvas (tripulantes, mapa, niebla de visión, minimapa)
public/minigames.js minijuegos de tareas y sabotajes
```

## Desplegar

Cualquier hosting de Node con WebSockets vale (Render, Railway, Fly.io). Comando de inicio: `npm start`; el puerto se lee de `PORT`.
