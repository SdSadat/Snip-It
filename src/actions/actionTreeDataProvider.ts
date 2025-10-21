import { Event, EventEmitter, ProviderResult, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ActionDefinition } from "./actionTypes";

const GENERAL_GROUP = "General";
const TAG_CONTEXT = "snipIt.tag";
const ACTION_CONTEXT = "snipIt.action";

export type ActionTreeNode = ActionGroupNode | ActionLeafNode;

export interface ActionGroupNode {
  readonly type: "group";
  readonly label: string;
  readonly actions: readonly ActionDefinition[];
}

export interface ActionLeafNode {
  readonly type: "action";
  readonly action: ActionDefinition;
  readonly group: string;
}

export class ActionTreeItem extends TreeItem {
  constructor(readonly node: ActionTreeNode) {
    if (node.type === "group") {
      super(node.label, TreeItemCollapsibleState.Expanded);
      this.contextValue = TAG_CONTEXT;
      this.id = `tag:${node.label}`;
    } else {
      super(node.action.name, TreeItemCollapsibleState.None);
      this.contextValue = ACTION_CONTEXT;
      this.description = node.action.description;
      this.tooltip = node.action.description ?? node.action.name;
      this.iconPath = new ThemeIcon("run");
      this.id = `${node.group}:${node.action.id}`;
      this.command = {
        command: "snip-it.runAction",
        title: "Run Action",
        arguments: [node.action.id],
      };
    }
  }
}

export class ActionTreeDataProvider implements TreeDataProvider<ActionTreeNode> {
  private readonly changeEmitter = new EventEmitter<void>();
  private actions: readonly ActionDefinition[] = [];

  readonly onDidChangeTreeData: Event<void> = this.changeEmitter.event;

  setActions(actions: readonly ActionDefinition[]): void {
    this.actions = actions;
    this.changeEmitter.fire();
  }

  getTreeItem(node: ActionTreeNode): TreeItem | Thenable<TreeItem> {
    return new ActionTreeItem(node);
  }

  getChildren(node?: ActionTreeNode): ProviderResult<ActionTreeNode[]> {
    if (!node) {
      return this.buildGroups();
    }

    if (node.type === "group") {
      return node.actions.map(action => ({ type: "action", action, group: node.label } as ActionLeafNode));
    }

    return [];
  }

  private buildGroups(): ActionTreeNode[] {
    if (this.actions.length === 0) {
      return [];
    }

    const grouped = new Map<string, ActionDefinition[]>();

    for (const action of this.actions) {
      const tags = action.tags.length > 0 ? action.tags : [GENERAL_GROUP];
      for (const tag of tags) {
        const bucket = grouped.get(tag) ?? [];
        bucket.push(action);
        grouped.set(tag, bucket);
      }
    }

    const sortedGroups = Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map<ActionTreeNode>(([tag, items]) => ({
        type: "group",
        label: tag,
        actions: items.sort((left, right) => left.name.localeCompare(right.name)),
      }));

    return sortedGroups;
  }
}
