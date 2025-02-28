// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Dialog, showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { Contents } from '@jupyterlab/services';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { JSONObject } from '@lumino/coreutils';
import { Widget } from '@lumino/widgets';
import { IDocumentManager } from './';

/**
 * The class name added to file dialogs.
 */
const FILE_DIALOG_CLASS = 'jp-FileDialog';

/**
 * The class name added to checkboxes in file dialogs.
 */
const FILE_DIALOG_CHECKBOX_CLASS = 'jp-FileDialog-Checkbox';

/**
 * The class name added for the new name label in the rename dialog
 */
const RENAME_NEW_NAME_TITLE_CLASS = 'jp-new-name-title';

/**
 * A stripped-down interface for a file container.
 */
export interface IFileContainer extends JSONObject {
  /**
   * The list of item names in the current working directory.
   */
  items: string[];
  /**
   * The current working directory of the file container.
   */
  path: string;
}

/**
 * Rename a file with a dialog.
 */
export function renameDialog(
  manager: IDocumentManager,
  oldPath: string,
  translator?: ITranslator
): Promise<Contents.IModel | null> {
  translator = translator || nullTranslator;
  const trans = translator.load('jupyterlab');

  return showDialog({
    title: trans.__('Rename File'),
    body: new RenameHandler(oldPath),
    focusNodeSelector: 'input',
    buttons: [
      Dialog.cancelButton({ label: trans.__('Cancel') }),
      Dialog.okButton({ label: trans.__('Rename') })
    ]
  }).then(result => {
    if (!result.value) {
      return null;
    }
    if (!isValidFileName(result.value)) {
      void showErrorMessage(
        trans.__('Rename Error'),
        Error(
          trans.__(
            '"%1" is not a valid name for a file. Names must have nonzero length, and cannot include "/", "\\", or ":"',
            result.value
          )
        )
      );
      return null;
    }
    const basePath = PathExt.dirname(oldPath);
    const newPath = PathExt.join(basePath, result.value);
    return renameFile(manager, oldPath, newPath);
  });
}

/**
 * Name a file on first save with a dialog.
 */
export function nameOnSaveDialog(
  manager: IDocumentManager,
  context: DocumentRegistry.Context,
  translator?: ITranslator
): Promise<Contents.IModel | null> {
  translator = translator || nullTranslator;
  const trans = translator.load('jupyterlab');
  const oldPath = context.path;

  return showDialog({
    title: trans.__('Name File'),
    body: new NameOnSaveHandler(manager, oldPath),
    focusNodeSelector: 'input',
    buttons: [Dialog.okButton({ label: trans.__('Enter') })]
  }).then(result => {
    context.model.dirty = false;
    context.contentsModel!.renamed = true;
    if (!result.value) {
      return renameFile(manager, oldPath, oldPath);
    }

    if (!isValidFileName(result.value)) {
      void showErrorMessage(
        trans.__('Naming Error'),
        Error(
          trans.__(
            '"%1" is not a valid name for a file. Names must have nonzero length, and cannot include "/", "\\", or ":"',
            result.value
          )
        )
      );
      return renameFile(manager, oldPath, oldPath);
    }
    const basePath = PathExt.dirname(oldPath);
    const newPath = PathExt.join(basePath, result.value);
    return renameFile(manager, oldPath, newPath);
  });
}

/**
 * Rename a file, asking for confirmation if it is overwriting another.
 */
export function renameFile(
  manager: IDocumentManager,
  oldPath: string,
  newPath: string
): Promise<Contents.IModel | null> {
  return manager.rename(oldPath, newPath).catch(error => {
    if (error.message.indexOf('409') === -1) {
      throw error;
    }
    return shouldOverwrite(newPath).then(value => {
      if (value) {
        return manager.overwrite(oldPath, newPath);
      }
      return Promise.reject('File not renamed');
    });
  });
}

/**
 * Ask the user whether to overwrite a file.
 */
export function shouldOverwrite(
  path: string,
  translator?: ITranslator
): Promise<boolean> {
  translator = translator || nullTranslator;
  const trans = translator.load('jupyterlab');

  const options = {
    title: trans.__('Overwrite file?'),
    body: trans.__('"%1" already exists, overwrite?', path),
    buttons: [
      Dialog.cancelButton({ label: trans.__('Cancel') }),
      Dialog.warnButton({ label: trans.__('Overwrite') })
    ]
  };
  return showDialog(options).then(result => {
    return Promise.resolve(result.button.accept);
  });
}

/**
 * Test whether a name is a valid file name
 *
 * Disallows "/", "\", and ":" in file names, as well as names with zero length.
 */
export function isValidFileName(name: string): boolean {
  const validNameExp = /[\/\\:]/;
  return name.length > 0 && !validNameExp.test(name);
}

/**
 * A widget used to rename a file.
 */
class RenameHandler extends Widget {
  /**
   * Construct a new "rename" dialog.
   */
  constructor(oldPath: string) {
    super({ node: Private.createRenameNode(oldPath) });
    this.addClass(FILE_DIALOG_CLASS);
    const ext = PathExt.extname(oldPath);
    const value = (this.inputNode.value = PathExt.basename(oldPath));
    this.inputNode.setSelectionRange(0, value.length - ext.length);
  }

  /**
   * Get the input text node.
   */
  get inputNode(): HTMLInputElement {
    return this.node.getElementsByTagName('input')[0] as HTMLInputElement;
  }

  /**
   * Get the value of the widget.
   */
  getValue(): string {
    return this.inputNode.value;
  }
}

/**
 * A namespace for private data.
 */
namespace Private {
  /**
   * Create the node for a rename handler.
   */
  export function createRenameNode(
    oldPath: string,
    translator?: ITranslator
  ): HTMLElement {
    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab');

    const body = document.createElement('div');
    const existingLabel = document.createElement('label');
    existingLabel.textContent = trans.__('File Path');
    const existingPath = document.createElement('span');
    existingPath.textContent = oldPath;

    const nameTitle = document.createElement('label');
    nameTitle.textContent = trans.__('New Name');
    nameTitle.className = RENAME_NEW_NAME_TITLE_CLASS;
    const name = document.createElement('input');

    body.appendChild(existingLabel);
    body.appendChild(existingPath);
    body.appendChild(nameTitle);
    body.appendChild(name);
    return body;
  }
}

/**
 * A widget used to name file on first save.
 */
class NameOnSaveHandler extends Widget {
  /**
   * Construct a new "name notebook file" dialog.
   */
  constructor(manager: IDocumentManager, oldPath: string) {
    super({ node: Private.createNameFileNode(manager) });
    this.addClass(FILE_DIALOG_CLASS);
    const ext = PathExt.extname(oldPath);
    const value = (this.inputNode.value = PathExt.basename(oldPath));
    this.inputNode.setSelectionRange(0, value.length - ext.length);
  }

  /**
   * Get the input text node.
   */
  get inputNode(): HTMLInputElement {
    return this.node.getElementsByTagName('input')[0] as HTMLInputElement;
  }

  /**
   * Get the value of the input widget.
   */
  getValue(): string {
    return this.inputNode.value;
  }
}

/**
 * A namespace for private data.
 */
namespace Private {
  /**
   * Create the node for the name file dialog handler.
   */
  export function createNameFileNode(
    manager: IDocumentManager,
    translator?: ITranslator
  ): HTMLElement {
    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab');
    const body = document.createElement('div');
    const name = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.id = 'jp-filedialog-input-id';
    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    const div = document.createElement('div');
    div.classList.add(FILE_DIALOG_CHECKBOX_CLASS);

    checkbox.type = 'checkbox';
    checkbox.addEventListener('change', function () {
      manager.nameFileOnSave = !this.checked;
    });

    label.textContent = trans.__("Don't ask me again");
    body.appendChild(name);
    div.appendChild(checkbox);
    div.appendChild(label);
    body.appendChild(div);

    return body;
  }
}
