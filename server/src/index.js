// Starts the game server on PORT (default 2567): npm run dev:server from the project root.

import { listen } from '@colyseus/tools';
import { server } from './app.js';

listen(server, Number(process.env.PORT) || 2567);
