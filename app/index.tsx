/**
 * LCD Compatibility Finder
 * Features: Search, Add/Edit LCD, Stock Toggle, Generate WhatsApp Price List
 * Storage: PostgreSQL via backend API (cloud, persists across rebuilds)
 */

import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

const C = Colors.light;

// ─── Types ────────────────────────────────────────────────────────────────────

interface LCD {
  id: string;
  brand: string;
  name: string;          // lcd_name from API
  models: string[];      // compatible_models from API
  supplier: string;
  purchaseRate: number;
  sellingPrice: number;
  inStock: boolean;
}

// Map API row → LCD
function rowToLcd(row: Record<string, unknown>): LCD {
  return {
    id: row.id as string,
    brand: (row.brand as string) ?? "",
    name: (row.lcdName ?? row.lcd_name) as string,
    models: (row.compatibleModels ?? row.compatible_models) as string[],
    supplier: (row.supplier as string) ?? "",
    purchaseRate: parseFloat((row.purchaseRate ?? row.purchase_rate ?? "0") as string),
    sellingPrice: parseFloat((row.sellingPrice ?? row.selling_price ?? "0") as string),
    inStock: (row.inStock ?? row.in_stock) as boolean,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Expand slash-variants: "A12/A12s" within a model string */
function expandSlashModels(model: string): string[] {
  const parts = model.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [model.trim()];
  const words = parts[0].split(/\s+/);
  const prefix = words.slice(0, -1).join(" ");
  return parts.map((p, i) => {
    if (i === 0) return p;
    return p.includes(" ") ? p : `${prefix} ${p}`.trim();
  });
}

/**
 * Generate WhatsApp price list.
 * Groups by the 'brand' field — no auto-detection.
 * Expands models, excludes out-of-stock.
 */
function generatePriceList(lcds: LCD[], shopName: string): string {
  // brand → list of { display, price }
  const brandMap = new Map<string, Array<{ display: string; price: number }>>();

  lcds
    .filter((l) => l.inStock)
    .forEach((lcd) => {
      const brand = (lcd.brand || "OTHER").toUpperCase();
      if (!brandMap.has(brand)) brandMap.set(brand, []);
      const bucket = brandMap.get(brand)!;

      lcd.models.forEach((rawModel) => {
        const expanded = expandSlashModels(rawModel);
        expanded.forEach((m) => {
          const display = m.trim();
          // Avoid duplicate model names within same brand
          if (!bucket.some((b) => norm(b.display) === norm(display))) {
            bucket.push({ display, price: lcd.sellingPrice });
          }
        });
      });
    });

  if (brandMap.size === 0) return "";

  const name = shopName.trim() || "SHOP";
  const lines: string[] = [];

  lines.push("🔥New Fresh Stock Arrived 🔥");
  lines.push("");
  lines.push(`💎*\`\`\`${name}\`\`\`*🔥 _HD++_`);
  lines.push("🔆500+");
  lines.push(" ```super duper universal``` ");
  lines.push("");

  // Sort brands alphabetically
  const sortedBrands = [...brandMap.keys()].sort();
  sortedBrands.forEach((brand) => {
    const models = brandMap.get(brand)!.sort((a, b) =>
      a.display.localeCompare(b.display)
    );
    lines.push(`*${brand}*`);
    models.forEach(({ display, price }) => {
      lines.push(`${display} - ₹${price.toLocaleString()}`);
    });
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

// ─── API Client ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit) {
  const base = getApiUrl();
  const url = new URL(path, base).toString();
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${options?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchAllLCDs(): Promise<LCD[]> {
  const rows = await apiFetch("/api/lcds");
  return rows.map(rowToLcd);
}

async function createLCD(data: Omit<LCD, "id">): Promise<LCD> {
  const id = genId();
  const row = await apiFetch("/api/lcds", {
    method: "POST",
    body: JSON.stringify({
      id,
      brand: data.brand,
      lcdName: data.name,
      compatibleModels: data.models,
      supplier: data.supplier,
      purchaseRate: data.purchaseRate,
      sellingPrice: data.sellingPrice,
      inStock: data.inStock,
    }),
  });
  return rowToLcd(row);
}

async function updateLCD(lcd: LCD): Promise<LCD> {
  const row = await apiFetch(`/api/lcds/${lcd.id}`, {
    method: "PUT",
    body: JSON.stringify({
      brand: lcd.brand,
      lcdName: lcd.name,
      compatibleModels: lcd.models,
      supplier: lcd.supplier,
      purchaseRate: lcd.purchaseRate,
      sellingPrice: lcd.sellingPrice,
      inStock: lcd.inStock,
    }),
  });
  return rowToLcd(row);
}

async function toggleStockAPI(id: string, inStock: boolean): Promise<LCD> {
  const row = await apiFetch(`/api/lcds/${id}/stock`, {
    method: "PATCH",
    body: JSON.stringify({ inStock }),
  });
  return rowToLcd(row);
}

async function deleteLCD(id: string): Promise<void> {
  await apiFetch(`/api/lcds/${id}`, { method: "DELETE" });
}

// ─── ModelTag ─────────────────────────────────────────────────────────────────

function ModelTag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

// ─── LCD Card ─────────────────────────────────────────────────────────────────

function LCDCard({
  item,
  searchQuery,
  onEdit,
  onDelete,
  onToggleStock,
}: {
  item: LCD;
  searchQuery: string;
  onEdit: (item: LCD) => void;
  onDelete: (id: string) => void;
  onToggleStock: (id: string) => void;
}) {
  const matchedModel =
    searchQuery.length > 0
      ? item.models.find((m) => norm(m).includes(norm(searchQuery)))
      : null;

  const isOut = !item.inStock;

  return (
    <View style={[styles.card, isOut && styles.cardOutOfStock]}>
      {/* Row 1: Icon + Name + Actions */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.lcdIconWrapper, isOut && styles.lcdIconOut]}>
            <Feather name="monitor" size={15} color={isOut ? C.textSecondary : C.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Brand label */}
            {item.brand ? (
              <Text style={styles.brandLabel} numberOfLines={1}>
                {item.brand.toUpperCase()}
              </Text>
            ) : null}
            <Text style={[styles.cardTitle, isOut && styles.cardTitleOut]} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
        </View>

        <View style={styles.cardActions}>
          {/* Stock toggle */}
          <TouchableOpacity
            onPress={() => onToggleStock(item.id)}
            style={[styles.stockPill, isOut ? styles.stockPillOut : styles.stockPillIn]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <View style={[styles.stockDot, isOut ? styles.stockDotOut : styles.stockDotIn]} />
            <Text style={[styles.stockText, isOut ? styles.stockTextOut : styles.stockTextIn]}>
              {isOut ? "Out" : "In"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onEdit(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.actionBtn}
          >
            <Feather name="edit-2" size={14} color={C.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDelete(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.actionBtn}
          >
            <Feather name="trash-2" size={14} color={C.danger} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Row 2: Supplier + Prices */}
      <View style={styles.priceRow}>
        <Text style={styles.supplierText} numberOfLines={1}>
          {item.supplier}
        </Text>
        <View style={styles.pricesGroup}>
          <View style={styles.priceBuy}>
            <Text style={styles.priceBuyLabel}>Buy</Text>
            <Text style={styles.priceBuyValue}>₹{item.purchaseRate.toLocaleString()}</Text>
          </View>
          {/* Price tag badge */}
          <View style={[styles.priceSell, isOut && styles.priceSellOut]}>
            <Text style={styles.priceSellValue}>₹{item.sellingPrice.toLocaleString()}</Text>
            <Text style={styles.priceSellLabel}>Sell</Text>
          </View>
        </View>
      </View>

      {/* Search match highlight */}
      {matchedModel && (
        <View style={styles.matchBadge}>
          <Feather name="check-circle" size={11} color={C.success} />
          <Text style={styles.matchBadgeText}>
            Matched:{" "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>{matchedModel}</Text>
          </Text>
        </View>
      )}

      {/* Compatible models */}
      <View style={styles.modelsSection}>
        <Text style={styles.modelsLabel}>
          Compatible ({item.models.length})
        </Text>
        <View style={styles.tagsWrap}>
          {item.models.map((m) => (
            <ModelTag key={m} label={m} />
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Form Field ───────────────────────────────────────────────────────────────

function Field({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  hint,
  multiline,
  keyboardType,
  editable = true,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string;
  hint?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric";
  editable?: boolean;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          !!error && styles.inputError,
          !editable && styles.inputDisabled,
        ]}
        placeholder={placeholder}
        placeholderTextColor={C.textSecondary}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        keyboardType={keyboardType ?? "default"}
        editable={editable}
        autoCorrect={false}
        autoCapitalize={multiline ? "sentences" : "words"}
      />
      {hint && !error && <Text style={styles.fieldHint}>{hint}</Text>}
      {error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

interface FormState {
  brand: string;
  name: string;
  modelsRaw: string;
  supplier: string;
  purchaseRate: string;
  sellingPrice: string;
}

const EMPTY_FORM: FormState = {
  brand: "",
  name: "",
  modelsRaw: "",
  supplier: "",
  purchaseRate: "",
  sellingPrice: "",
};

function LCDFormModal({
  visible,
  editItem,
  onClose,
  onSave,
}: {
  visible: boolean;
  editItem: LCD | null;
  onClose: () => void;
  onSave: (data: {
    brand: string;
    name: string;
    models: string[];
    supplier: string;
    purchaseRate: number;
    sellingPrice: number;
    editId?: string;
  }) => void;
}) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  useEffect(() => {
    if (editItem) {
      setForm({
        brand: editItem.brand,
        name: editItem.name,
        modelsRaw: editItem.models.join(", "),
        supplier: editItem.supplier,
        purchaseRate: String(editItem.purchaseRate),
        sellingPrice: String(editItem.sellingPrice),
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setErrors({});
  }, [editItem, visible]);

  const set = (field: keyof FormState) => (val: string) => {
    setForm((prev) => ({ ...prev, [field]: val }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  function validate(): boolean {
    const e: Partial<FormState> = {};
    if (!form.brand.trim()) e.brand = "Brand is required";
    if (!form.name.trim()) e.name = "LCD name is required";
    if (!form.modelsRaw.trim()) e.modelsRaw = "At least one model is required";
    if (!form.supplier.trim()) e.supplier = "Supplier name is required";
    const rate = parseFloat(form.purchaseRate);
    if (!form.purchaseRate.trim() || isNaN(rate) || rate < 0)
      e.purchaseRate = "Enter a valid purchase rate";
    const sell = parseFloat(form.sellingPrice);
    if (!form.sellingPrice.trim() || isNaN(sell) || sell < 0)
      e.sellingPrice = "Enter a valid selling price";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    const models = form.modelsRaw
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const uniqueModels = [...new Set(models.map(norm))].map(
      (n) => models.find((m) => norm(m) === n) ?? n
    );
    onSave({
      brand: form.brand.trim(),
      name: form.name.trim(),
      models: uniqueModels,
      supplier: form.supplier.trim(),
      purchaseRate: parseFloat(form.purchaseRate),
      sellingPrice: parseFloat(form.sellingPrice),
      editId: editItem?.id,
    });
  }

  const isEdit = !!editItem;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[
            styles.modalContainer,
            { paddingTop: Platform.OS === "ios" ? 12 : insets.top + 12 },
          ]}
        >
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{isEdit ? "Edit LCD" : "Add New LCD"}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={20} color={C.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.modalBody,
              { paddingBottom: insets.bottom + 32 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Brand field */}
            <Field
              label="Brand"
              placeholder="e.g. OPPO, Samsung, Vivo..."
              value={form.brand}
              onChangeText={set("brand")}
              error={errors.brand}
              hint="Used for grouping in the WhatsApp price list"
            />

            <Field
              label="LCD Name"
              placeholder="e.g. SAFIRE HD++"
              value={form.name}
              onChangeText={set("name")}
              error={errors.name}
            />
            <Field
              label="Compatible Models"
              placeholder="A12, A15, A17, A18, ..."
              value={form.modelsRaw}
              onChangeText={set("modelsRaw")}
              error={errors.modelsRaw}
              hint="Separate models with commas. Use / for variants: A12/A12s"
              multiline
            />
            <Field
              label="Supplier Name"
              placeholder="e.g. Rahman Traders"
              value={form.supplier}
              onChangeText={set("supplier")}
              error={errors.supplier}
            />
            {/* Purchase Rate & Selling Price side by side */}
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Purchase Rate (₹)"
                  placeholder="420"
                  value={form.purchaseRate}
                  onChangeText={set("purchaseRate")}
                  error={errors.purchaseRate}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Selling Price (₹)"
                  placeholder="470"
                  value={form.sellingPrice}
                  onChangeText={set("sellingPrice")}
                  error={errors.sellingPrice}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <Feather name={isEdit ? "check" : "plus"} size={18} color="#fff" />
              <Text style={styles.saveBtnText}>
                {isEdit ? "Save Changes" : "Add LCD"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Price List Modal ─────────────────────────────────────────────────────────

function PriceListModal({
  visible,
  lcds,
  onClose,
}: {
  visible: boolean;
  lcds: LCD[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [shopName, setShopName] = useState("SAFIRE");
  const [priceText, setPriceText] = useState("");
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);

  const inStockCount = lcds.filter((l) => l.inStock).length;
  const outCount = lcds.length - inStockCount;

  function handleGenerate() {
    const text = generatePriceList(lcds, shopName);
    if (!text) {
      Alert.alert("No Stock", "No in-stock LCDs found to generate a price list.");
      return;
    }
    setPriceText(text);
    setGenerated(true);
    setCopied(false);
  }

  async function handleCopy() {
    try {
      await Clipboard.setStringAsync(priceText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      Alert.alert("Error", "Could not copy to clipboard.");
    }
  }

  async function handleShare() {
    try {
      if (Platform.OS === "web") {
        const blob = new Blob([priceText], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `price-list-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: priceText, title: "Daily Price List" });
      }
    } catch {
      Alert.alert("Error", "Could not share the price list.");
    }
  }

  useEffect(() => {
    if (!visible) {
      setGenerated(false);
      setPriceText("");
      setCopied(false);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.modalContainer,
          { paddingTop: Platform.OS === "ios" ? 12 : insets.top + 12 },
        ]}
      >
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Generate Price List</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={20} color={C.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.modalBody,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Stock summary */}
          <View style={styles.stockSummary}>
            <View style={styles.stockSummaryItem}>
              <View style={[styles.stockDot, styles.stockDotIn]} />
              <Text style={styles.stockSummaryText}>
                <Text style={{ fontFamily: "Inter_600SemiBold" }}>{inStockCount}</Text> In Stock
              </Text>
            </View>
            {outCount > 0 && (
              <View style={styles.stockSummaryItem}>
                <View style={[styles.stockDot, styles.stockDotOut]} />
                <Text style={styles.stockSummaryText}>
                  <Text style={{ fontFamily: "Inter_600SemiBold" }}>{outCount}</Text> Excluded (Out of Stock)
                </Text>
              </View>
            )}
          </View>

          {/* Shop name input */}
          <Field
            label="Shop / LCD Brand Name"
            placeholder="e.g. SAFIRE"
            value={shopName}
            onChangeText={setShopName}
          />

          {/* Generate button */}
          <TouchableOpacity
            style={styles.generateBtn}
            onPress={handleGenerate}
            activeOpacity={0.85}
          >
            <Feather name="zap" size={18} color="#fff" />
            <Text style={styles.generateBtnText}>Generate WhatsApp Price List</Text>
          </TouchableOpacity>

          {/* Output */}
          {generated && priceText.length > 0 && (
            <View style={styles.outputWrapper}>
              <View style={styles.outputHeader}>
                <Text style={styles.outputLabel}>WhatsApp Ready</Text>
              </View>

              {/* Copyable text box */}
              <ScrollView
                style={styles.outputBox}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <TextInput
                  style={styles.outputText}
                  value={priceText}
                  multiline
                  editable={false}
                  selectTextOnFocus
                />
              </ScrollView>

              {/* Action buttons */}
              <View style={styles.outputActions}>
                <TouchableOpacity
                  style={[
                    styles.outputActionBtn,
                    copied && styles.outputActionBtnCopied,
                  ]}
                  onPress={handleCopy}
                  activeOpacity={0.85}
                >
                  <Feather
                    name={copied ? "check" : "copy"}
                    size={16}
                    color={copied ? "#fff" : C.accent}
                  />
                  <Text
                    style={[
                      styles.outputActionText,
                      copied && styles.outputActionTextCopied,
                    ]}
                  >
                    {copied ? "Copied!" : "Copy to Clipboard"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.outputShareBtn}
                  onPress={handleShare}
                  activeOpacity={0.85}
                >
                  <Feather name="share-2" size={16} color="#fff" />
                  <Text style={styles.outputShareText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function App() {
  const insets = useSafeAreaInsets();

  const [lcds, setLcds] = useState<LCD[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<LCD | null>(null);
  const [showPriceList, setShowPriceList] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load from API on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchAllLCDs();
        setLcds(data);
      } catch (e) {
        Alert.alert("Error", "Could not load LCD data. Check your connection.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Filter by search
  const filtered = useMemo(() => {
    const q = norm(searchQuery);
    if (!q) return lcds;
    return lcds.filter((lcd) => {
      const inModels = lcd.models.some((m) => norm(m).includes(q));
      const inName = norm(lcd.name).includes(q);
      const inBrand = norm(lcd.brand).includes(q);
      return inModels || inName || inBrand;
    });
  }, [lcds, searchQuery]);

  // Open add form
  const handleAdd = useCallback(() => {
    setEditItem(null);
    setShowForm(true);
  }, []);

  // Open edit form
  const handleEdit = useCallback((item: LCD) => {
    setEditItem(item);
    setShowForm(true);
  }, []);

  // Delete
  const handleDelete = useCallback((id: string) => {
    Alert.alert("Delete LCD", "Are you sure you want to delete this entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteLCD(id);
            setLcds((prev) => prev.filter((l) => l.id !== id));
          } catch {
            Alert.alert("Error", "Could not delete this entry.");
          }
        },
      },
    ]);
  }, []);

  // Toggle stock
  const handleToggleStock = useCallback(async (id: string) => {
    const item = lcds.find((l) => l.id === id);
    if (!item) return;
    const newInStock = !item.inStock;
    // Optimistic update
    setLcds((prev) =>
      prev.map((l) => (l.id === id ? { ...l, inStock: newInStock } : l))
    );
    try {
      await toggleStockAPI(id, newInStock);
    } catch {
      // Revert on failure
      setLcds((prev) =>
        prev.map((l) => (l.id === id ? { ...l, inStock: !newInStock } : l))
      );
      Alert.alert("Error", "Could not update stock status.");
    }
  }, [lcds]);

  // Save (add or edit)
  const handleSave = useCallback(async (data: {
    brand: string;
    name: string;
    models: string[];
    supplier: string;
    purchaseRate: number;
    sellingPrice: number;
    editId?: string;
  }) => {
    if (saving) return;
    setSaving(true);
    try {
      if (data.editId) {
        const existing = lcds.find((l) => l.id === data.editId)!;
        const updated = await updateLCD({
          ...existing,
          brand: data.brand,
          name: data.name,
          models: data.models,
          supplier: data.supplier,
          purchaseRate: data.purchaseRate,
          sellingPrice: data.sellingPrice,
        });
        setLcds((prev) =>
          prev.map((l) => (l.id === data.editId ? updated : l))
        );
      } else {
        const created = await createLCD({
          brand: data.brand,
          name: data.name,
          models: data.models,
          supplier: data.supplier,
          purchaseRate: data.purchaseRate,
          sellingPrice: data.sellingPrice,
          inStock: true,
        });
        setLcds((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch {
      Alert.alert("Error", "Could not save LCD. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [lcds, saving]);

  const webTopPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <StatusBar barStyle="dark-content" backgroundColor={C.surface} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: webTopPad + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>LCD Finder</Text>
          <Text style={styles.headerSub}>{lcds.length} entries · cloud sync</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.priceListBtn}
            onPress={() => setShowPriceList(true)}
            activeOpacity={0.8}
          >
            <Feather name="list" size={14} color={C.accent} />
            <Text style={styles.priceListBtnText}>Price List</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={handleAdd}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color={C.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by model, brand, or LCD name..."
            placeholderTextColor={C.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && Platform.OS !== "ios" && (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color={C.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Results count */}
      {searchQuery.length > 0 && (
        <View style={styles.resultsBanner}>
          <Text style={styles.resultsBannerText}>
            {filtered.length === 0
              ? "No matches found"
              : `${filtered.length} match${filtered.length !== 1 ? "es" : ""} for "${searchQuery}"`}
          </Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={[styles.loadingText, { marginTop: 12 }]}>Loading inventory...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <LCDCard
              item={item}
              searchQuery={searchQuery}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleStock={handleToggleStock}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingBottom:
                Platform.OS === "web" ? 34 : insets.bottom + 20,
            },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Feather name="monitor" size={32} color={C.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>
                {searchQuery ? "No matches" : "No LCDs added yet"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? `No LCD found for "${searchQuery}". Try a different model name.`
                  : "Tap the + button to add your first LCD entry."}
              </Text>
              {!searchQuery && (
                <TouchableOpacity style={styles.emptyBtn} onPress={handleAdd}>
                  <Feather name="plus" size={16} color={C.accent} />
                  <Text style={styles.emptyBtnText}>Add First LCD</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          scrollEnabled
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}

      {/* Add/Edit Modal */}
      <LCDFormModal
        visible={showForm}
        editItem={editItem}
        onClose={() => setShowForm(false)}
        onSave={handleSave}
      />

      {/* Price List Modal */}
      <PriceListModal
        visible={showPriceList}
        lcds={lcds}
        onClose={() => setShowPriceList(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: C.text,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  priceListBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.accent,
    backgroundColor: C.accentLight,
  },
  priceListBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.accent,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  // Search
  searchWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.surface,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 11 : 9,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
    padding: 0,
  },

  // Results banner
  resultsBanner: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  resultsBannerText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },

  // List
  listContent: {
    padding: 14,
    gap: 10,
  },

  // Card
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardOutOfStock: {
    backgroundColor: "#FAFAFA",
    borderColor: "#E0E0E0",
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  lcdIconWrapper: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: C.accentLight,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  lcdIconOut: { backgroundColor: "#F0F0F0" },

  // Brand label (above LCD name)
  brandLabel: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: C.accent,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  cardTitleOut: { color: C.textSecondary },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },

  // Stock pill
  stockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  stockPillIn: {
    backgroundColor: "#F0FFF4",
    borderColor: "#BBF7D0",
  },
  stockPillOut: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FED7AA",
  },
  stockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stockDotIn: { backgroundColor: C.success },
  stockDotOut: { backgroundColor: "#F97316" },
  stockText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  stockTextIn: { color: "#15803D" },
  stockTextOut: { color: "#C2410C" },
  actionBtn: { padding: 4 },

  // Prices
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  supplierText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  pricesGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  priceBuy: {
    alignItems: "flex-end",
  },
  priceBuyLabel: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  priceBuyValue: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  // Price tag badge (sell price)
  priceSell: {
    backgroundColor: C.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignItems: "center",
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  priceSellOut: {
    backgroundColor: "#9CA3AF",
    shadowColor: "transparent",
  },
  priceSellValue: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  priceSellLabel: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.8)",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  // Match badge
  matchBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F0FFF4",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
    alignSelf: "flex-start",
  },
  matchBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#15803D",
  },

  // Models
  modelsSection: { marginTop: 2 },
  modelsLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 7,
  },
  tagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  tag: {
    backgroundColor: C.tag,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  tagText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: C.tagText,
  },

  // Empty
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.accent,
  },
  emptyBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: C.accent,
  },

  // Loading
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },

  // Modal shared
  modalContainer: {
    flex: 1,
    backgroundColor: C.surface,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: C.text,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.background,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBody: {
    padding: 20,
    gap: 18,
  },

  // Form
  fieldWrapper: { gap: 5 },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  input: {
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 13 : 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
  inputMultiline: {
    minHeight: 80,
    paddingTop: 12,
  },
  inputError: { borderColor: C.danger },
  inputDisabled: { opacity: 0.45, backgroundColor: C.border },
  fieldHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  fieldError: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.danger,
  },
  rowFields: {
    flexDirection: "row",
    gap: 12,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 2,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  // Price list modal
  stockSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    backgroundColor: C.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  stockSummaryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stockSummaryText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1D2B3A",
    borderRadius: 14,
    paddingVertical: 15,
  },
  generateBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  // Output
  outputWrapper: {
    gap: 12,
  },
  outputHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  outputLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  outputBox: {
    backgroundColor: "#F8F9FB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    maxHeight: 320,
    padding: 2,
  },
  outputText: {
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    color: C.text,
    lineHeight: 20,
    padding: 12,
  },
  outputActions: {
    flexDirection: "row",
    gap: 10,
  },
  outputActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.accent,
    backgroundColor: C.accentLight,
  },
  outputActionBtnCopied: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  outputActionText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: C.accent,
  },
  outputActionTextCopied: { color: "#fff" },
  outputShareBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: "#1D2B3A",
  },
  outputShareText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
