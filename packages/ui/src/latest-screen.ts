import { Component, inject, input } from '@angular/core';
import { ProductWorkspace } from './product-workspace';
import { ProductScreen } from './product-screen';

@Component({
  selector: 'fp-latest-screen',
  imports: [ProductScreen],
  template: `<fp-product-screen [view]="view()" />`,
})
export class LatestScreen {
  readonly workspace = inject(ProductWorkspace);
  readonly view = input('inicio');

  constructor() {
    // The public web now presents the real product shell. Personal information
    // still remains locked until a private authenticated profile is available.
    this.workspace.product.set(true);
  }
}
