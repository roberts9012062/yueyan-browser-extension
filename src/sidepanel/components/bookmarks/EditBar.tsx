// browser-extension/src/sidepanel/components/bookmarks/EditBar.tsx
// 编辑模式横向操作条：全选 / 删除（二次确认）/ 移动 / 完成。
import { useState } from 'react';

interface EditBarProps {
  /** 当前视图下可多选的实体总数 */
  selectableCount: number;
  /** 已选数量 */
  selectedCount: number;
  /** 切换全选/取消全选 */
  onToggleSelectAll: () => void;
  /** 删除选中项（父级执行后自动退出确认态） */
  onDelete: () => void;
  /** 打开移动弹层 */
  onMoveClick: () => void;
  /** 退出编辑模式 */
  onFinish: () => void;
}

/** 横向小按钮样式 */
const ACTION_BTN: string =
  'rounded-full px-3 py-1.5 text-xs transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40';

export function EditBar(props: EditBarProps) {
  const [confirming, setConfirming] = useState<boolean>(false);
  const allSelected: boolean = props.selectedCount > 0 && props.selectedCount === props.selectableCount;

  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-line bg-elevated px-2.5 py-2">
      <span className="mr-auto text-[11px] text-ink-3">已选 {props.selectedCount} 项</span>
      <button
        type="button"
        onClick={props.onToggleSelectAll}
        className={`${ACTION_BTN} bg-muted text-ink`}
      >
        {allSelected ? '取消全选' : '全选'}
      </button>
      <button
        type="button"
        disabled={props.selectedCount === 0}
        onClick={(): void => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          props.onDelete();
          setConfirming(false);
        }}
        onBlur={(): void => setConfirming(false)}
        className={`${ACTION_BTN} ${confirming ? 'bg-like text-on-accent' : 'border border-like/50 text-like'}`}
        title={confirming ? '再点一次确认删除' : '删除'}
      >
        {confirming ? '确认删除？' : '删除'}
      </button>
      <button
        type="button"
        disabled={props.selectedCount === 0}
        onClick={props.onMoveClick}
        className={`${ACTION_BTN} bg-muted text-ink`}
      >
        移动
      </button>
      <button
        type="button"
        onClick={props.onFinish}
        className={`${ACTION_BTN} bg-accent text-on-accent`}
      >
        完成
      </button>
    </div>
  );
}
