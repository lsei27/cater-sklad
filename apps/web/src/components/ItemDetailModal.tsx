import Modal from "./ui/Modal";
import { Icons } from "../lib/icons";
import { apiUrl } from "../lib/api";
import { formatCategoryParentLabel } from "../lib/viewModel";

export type ItemDetail = {
  itemId: string;
  name: string;
  sku?: string | null;
  unit: string;
  imageUrl?: string | null;
  masterPackageQty?: number | null;
  masterPackageWeight?: string | null;
  volume?: string | null;
  plateDiameter?: string | null;
  warehouse?: { id: string; name: string } | null;
  category: {
    parent?: { name: string } | null;
    sub?: { name: string } | null;
  };
  stock?: {
    total: number;
    reserved: number;
    available: number;
  };
};

type Props = {
  item: ItemDetail | null;
  warehouses: Array<{ id: string; name: string }>;
  warehouseStocks: Record<string, Record<string, number>>;
  onClose: () => void;
  primaryText?: string;
  onPrimary?: () => void;
};

export default function ItemDetailModal({
  item,
  warehouses,
  warehouseStocks,
  onClose,
  primaryText,
  onPrimary
}: Props) {
  return (
    <Modal
      open={!!item}
      onOpenChange={(v) => !v && onClose()}
      title={item?.name ?? ""}
      description={
        item
          ? formatCategoryParentLabel(item.category.parent?.name, item.category.sub?.name)
          : ""
      }
      contentClassName="max-w-2xl"
      primaryText={primaryText}
      onPrimary={onPrimary}
      secondaryText="Zavřít"
      onSecondary={onClose}
    >
      {item && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="aspect-square w-full rounded-lg bg-gray-100 overflow-hidden border border-gray-200 flex items-center justify-center">
            {item.imageUrl ? (
              <img
                className="h-full w-full object-contain p-2"
                src={apiUrl(item.imageUrl)}
                alt={item.name}
              />
            ) : (
              <div className="text-gray-400">
                <Icons.Image />
              </div>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <DetailRow label="SKU" value={item.sku || "—"} />
            <DetailRow label="Jednotka" value={item.unit} />
            <DetailRow
              label="Hlavní kategorie"
              value={item.category.parent?.name ?? item.category.sub?.name ?? "—"}
            />
            {item.category.parent && (
              <DetailRow label="Podkategorie" value={item.category.sub?.name ?? "—"} />
            )}
            <DetailRow label="Výchozí sklad" value={item.warehouse?.name ?? "—"} />
            <DetailRow
              label="Master balení"
              value={item.masterPackageQty ? `${item.masterPackageQty} ${item.unit}` : "—"}
            />
            {item.masterPackageWeight && (
              <DetailRow label="Hmotnost balení" value={`${item.masterPackageWeight} kg`} />
            )}
            {item.volume && <DetailRow label="Objem" value={`${item.volume} l`} />}
            {item.plateDiameter && (
              <DetailRow label="Průměr" value={`${item.plateDiameter} cm`} />
            )}
            {item.stock && (
              <>
                <DetailRow label="Celkem" value={`${item.stock.total} ${item.unit}`} />
                <DetailRow label="Rezervováno" value={`${item.stock.reserved} ${item.unit}`} />
                <DetailRow label="Volné" value={`${item.stock.available} ${item.unit}`} />
              </>
            )}
            <div className="pt-2 border-t border-gray-100">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                Rozmístění po skladech
              </div>
              <div className="space-y-1">
                {warehouses.map((w) => {
                  const s = warehouseStocks[item.itemId]?.[w.id] ?? 0;
                  return (
                    <div
                      key={w.id}
                      className="flex justify-between items-center bg-gray-50 px-2 py-1 rounded text-xs"
                    >
                      <span className="text-gray-600">{w.name}</span>
                      <span className="font-semibold text-gray-900">
                        {s} {item.unit}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2 border-b border-gray-50 pb-1">
      <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</span>
      <span className="text-sm text-gray-900 text-right">{value}</span>
    </div>
  );
}
