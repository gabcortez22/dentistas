import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatPEN, quoteTotals } from "@/lib/money";

export type QuotePdfData = {
  clinicName: string;
  patientName: string;
  patientDocument: string;
  number: number;
  createdAt: Date;
  validUntil: string;
  notes?: string;
  items: Array<{
    description: string;
    toothFdi?: number;
    quantity: number;
    unitPriceCents: number;
  }>;
  discountCents: number;
};

const ACCENT = "#0f766e";
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0f172a" },
  title: { fontSize: 18, color: ACCENT, marginBottom: 4 },
  clinic: { fontSize: 12, marginBottom: 12 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 4,
  },
  head: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
    paddingVertical: 4,
  },
  desc: { flex: 4 },
  small: { flex: 1, textAlign: "right" },
  totals: { marginTop: 10, alignItems: "flex-end" },
  total: { fontSize: 13, color: ACCENT, marginTop: 4 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 8, color: "#475569" },
});

function QuoteDocument({ data }: { data: QuotePdfData }) {
  const totals = quoteTotals(
    data.items,
    Math.min(
      data.discountCents,
      data.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0),
    ),
  );
  return (
    <Document title={`Cotización ${data.number}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.clinic}>{data.clinicName}</Text>
        <Text style={styles.title}>COTIZACIÓN N° {String(data.number).padStart(6, "0")}</Text>
        <Text>
          Paciente: {data.patientName} ({data.patientDocument})
        </Text>
        <Text>
          Fecha: {data.createdAt.toLocaleDateString("es-PE", { timeZone: "America/Lima" })} Vigente
          hasta: {data.validUntil}
        </Text>
        <View style={{ marginTop: 12 }}>
          <View style={styles.head}>
            <Text style={styles.desc}>Descripción</Text>
            <Text style={styles.small}>Pieza</Text>
            <Text style={styles.small}>Cant.</Text>
            <Text style={styles.small}>P. unit.</Text>
            <Text style={styles.small}>Subtotal</Text>
          </View>
          {data.items.map((item) => (
            <View
              key={`${item.description}-${item.toothFdi ?? ""}-${item.unitPriceCents}`}
              style={styles.row}
            >
              <Text style={styles.desc}>{item.description}</Text>
              <Text style={styles.small}>{item.toothFdi ?? ""}</Text>
              <Text style={styles.small}>{item.quantity}</Text>
              <Text style={styles.small}>{formatPEN(item.unitPriceCents)}</Text>
              <Text style={styles.small}>{formatPEN(item.quantity * item.unitPriceCents)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.totals}>
          <Text>Subtotal: {formatPEN(totals.subtotalCents)}</Text>
          <Text>Descuento: - {formatPEN(totals.discountCents)}</Text>
          <Text style={styles.total}>Total: {formatPEN(totals.totalCents)}</Text>
        </View>
        {data.notes ? <Text style={{ marginTop: 12 }}>Notas: {data.notes}</Text> : null}
        <Text style={styles.footer}>
          Cotización referencial. No constituye comprobante de pago.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument data={data} />);
}
