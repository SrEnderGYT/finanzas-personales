import { Component, inject, input } from '@angular/core';
import { ProductWorkspace } from './product-workspace';
import { ProductScreen } from './product-screen';
import { LockedProductScreen } from './locked-product-screen';
import { PublicProductScreen } from './public-product-screen';

@Component({
  selector: 'fp-latest-screen',
  imports: [ProductScreen, LockedProductScreen, PublicProductScreen],
  template: `
    @if (workspace.unlocked()) {
      <fp-product-screen [view]="view()" />
    } @else if (!workspace.auth.enabled) {
      <fp-public-product-screen [view]="view()" />
    } @else {
      <fp-locked-product-screen [view]="view()" />
    }
  `,
})
export class LatestScreen {
  readonly workspace = inject(ProductWorkspace);
  readonly view = input('inicio');

  constructor() {
    this.workspace.product.set(true);
  }
}
