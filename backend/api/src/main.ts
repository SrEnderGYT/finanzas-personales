import { createApp } from './app';
void createApp().then((app) => app.listen(Number(process.env['PORT'] ?? 3000), '127.0.0.1'));
