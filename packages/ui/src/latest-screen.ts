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
    this.workspace.enterProduct();
    if (this.workspace.auth.signedIn) void this.workspace.openRemote();
  }
}
