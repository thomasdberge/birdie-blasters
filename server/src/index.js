// Starts the game server on PORT (default 2567): npm run dev:server from the project root.

import { listen } from '@colyseus/tools';
import { server } from './app.js';

if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_ORIGINS) console.warn('CLIENT_ORIGINS is not set: only pages on localhost may use this server from a browser.');
listen(server, Number(process.env.PORT) || 2567);
