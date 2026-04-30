#!/usr/bin/env node
const port = process.env.PORT || "8787";
console.log(`BetterQuizzes Stage 12.1 tunnel helper\n`);
console.log(`1. Start the production server:`);
console.log(`   npm run build`);
console.log(`   npm run serve:prod\n`);
console.log(`2. Expose http://127.0.0.1:${port} using an HTTPS tunnel, such as ngrok or Cloudflare Tunnel.`);
console.log(`   Example target for the tunnel: http://127.0.0.1:${port}\n`);
console.log(`3. In a second terminal, set the public URL and run the strict public check:`);
console.log(`   set PUBLIC_BASE_URL=https://YOUR-TUNNEL-HOST`);
console.log(`   npm run host:public:strict\n`);
console.log(`4. The connector URL you will use in ChatGPT developer mode is:`);
console.log(`   https://YOUR-TUNNEL-HOST/mcp`);
