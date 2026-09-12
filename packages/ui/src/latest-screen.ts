import { Component, inject, input } from '@angular/core';
import { ProductWorkspace } from './product-workspace';
import { ProductScreen } from './product-screen';
import { LockedProductScreen } from './locked-product-screen';

@Component({
  selector: 'fp-latest-screen',
  imports: [ProductScreen, LockedProductScreen],
  template: `
    @if (workspace.unlocked()) {
      <fp-product-screen [view]="view()" />
    } @else {
      <fp-locked-product-screen [view]="view()" />
    }
  `,
})
export class LatestScreen {
  readonly workspace = inject(ProductWorkspace);
  readonly view = input('inicio');

  constructor() {
    // Present the product, never a synthetic financial dashboard, on public builds.
    this.workspace.product.set(true);
  }
}
