import { Component, inject, input } from '@angular/core';
import { ProductWorkspace } from './product-workspace';
import { ProductPreview } from './product-preview';
import { ProductScreen } from './product-screen';

@Component({
  selector: 'fp-latest-screen',
  imports: [ProductPreview, ProductScreen],
  template: `
    @if (workspace.product()) {
      <fp-product-screen [view]="view()" />
    } @else {
      <fp-product-preview [view]="view()" />
    }
  `,
})
export class LatestScreen {
  readonly workspace = inject(ProductWorkspace);
  readonly view = input('inicio');
}
