export type Currency = 'PEN' | 'USD';
export const DEMO_NOTICE = 'DEMO · Datos sintéticos, sin conexión bancaria';
export function assertDemo(value: { demo: boolean }): void {
  if (value.demo !== true) throw new Error('Only synthetic demo data is permitted');
}
