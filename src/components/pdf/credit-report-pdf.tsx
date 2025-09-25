// src/components/pdf/credit-report-pdf.tsx
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Image,
} from '@react-pdf/renderer'

export type CreditReportData = {
  fullName: string
  reportDate: string
  scores: string[][]
  summary: string[][]
  revolvingAccounts: string[][]
  revolvingStats: string[][]
  scoreImprovementTips: string[]
  alerts: string[]
  installmentAccounts: string[][]
}

// Paleta simple (CreditBanc vibe)
const colors = {
  brand: '#10B981',        // emerald-ish
  ink: '#0F172A',          // slate-900
  text: '#1F2937',         // gray-800
  sub: '#6B7280',          // gray-500
  border: '#D1D5DB',       // gray-300
  tableHeadBg: '#F3F4F6',  // gray-100
  zebra: '#FAFAFB',        // very light
}

const styles = StyleSheet.create({
  page: { padding: 28, fontFamily: 'Helvetica', color: colors.text },
  headerImg: { width: '100%', marginBottom: 16 },
  h1: { fontSize: 18, fontWeight: 'bold', color: colors.ink, marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: 'bold', color: colors.ink, marginBottom: 8 },
  p: { fontSize: 10, lineHeight: 1.4 },
  small: { fontSize: 9, color: colors.sub },

  // Card de sección
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 14,
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.ink,
    marginBottom: 6,
  },

  // Tabla
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    marginTop: 4,
  },
  tr: { flexDirection: 'row' },
  th: {
    fontSize: 9,
    fontWeight: 'bold',
    backgroundColor: colors.tableHeadBg,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    flexGrow: 1,
  },
  td: {
    fontSize: 9,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    flexGrow: 1,
  },
  zebra: { backgroundColor: colors.zebra },

  // Listas
  bullet: { fontSize: 10, marginLeft: 8, marginBottom: 2 },

  // Grid simple
  row: { flexDirection: 'row' },
  col: { flex: 1 },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 9,
    color: colors.sub,
    textAlign: 'center',
  },
})

// Helpers seguros (no asumen que venga todo perfecto)
const safeRows = (rows?: string[][]) => Array.isArray(rows) ? rows : []
const safeArr = (arr?: string[]) => Array.isArray(arr) ? arr : []

const Table = ({
  headers,
  rows,
  colWidths,
}: {
  headers: string[]
  rows: string[][]
  colWidths?: number[] // proporciones opcionales, ej [2,1,1]
}) => {
  const widths = colWidths && colWidths.length === headers.length ? colWidths : undefined

  return (
    <View style={styles.table}>
      {/* head */}
      <View style={styles.tr}>
        {headers.map((h, i) => (
          <Text
            key={i}
            style={[
              styles.th,
              widths ? { flexGrow: widths[i] } : {},
            ]}
          >
            {h}
          </Text>
        ))}
      </View>

      {/* body */}
      {safeRows(rows).map((row, rIdx) => (
        <View key={rIdx} style={[styles.tr, rIdx % 2 === 0 ? styles.zebra : {}]}>
          {row.map((cell, cIdx) => (
            <Text
              key={cIdx}
              style={[
                styles.td,
                widths ? { flexGrow: widths[cIdx] } : {},
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

export default function CreditReportPDF({
  data,
  headerUrl,
}: {
  data: CreditReportData
  headerUrl?: string
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Header */}
        <Image
          src={headerUrl || '/header-logo.png'}
          style={styles.headerImg}
        />

        {/* Título */}
        <Text style={styles.h1}>Credit Report</Text>

        {/* Client info */}
        <View style={[styles.card, { marginTop: 4 }]}>
          <Text style={styles.cardHeader}>Client Information</Text>
          <Text style={styles.p}>Full Name: {data.fullName || 'N/A'}</Text>
          <Text style={styles.p}>Report Date: {data.reportDate || 'N/A'}</Text>
        </View>

        {/* Scores */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Credit Scores</Text>
          <Table
            headers={['Bureau', 'FICO Score', 'Score Range']}
            rows={safeRows(data.scores)}
            colWidths={[2, 1, 1]}
          />
        </View>

        {/* Summary */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Account Summary</Text>
          <Table
            headers={['Metric', 'Count']}
            rows={safeRows(data.summary)}
            colWidths={[3, 1]}
          />
        </View>

        {/* Revolving Accounts */}
        <View style={styles.card} wrap>
          <Text style={styles.cardHeader}>Open Revolving Accounts</Text>
          <Table
            headers={[
              'Creditor Name',
              'Current Balance',
              'Credit Limit',
              'Utilization %',
              'Past Due',
              'Past Due Since',
            ]}
            rows={safeRows(data.revolvingAccounts)}
            colWidths={[2, 1, 1, 1, 1, 1]}
          />
        </View>

        {/* Stats */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Summary Stats</Text>
          <Table
            headers={['Total Revolving Balance', 'Total Credit Limit', 'Overall Utilization']}
            rows={safeRows(data.revolvingStats)}
            colWidths={[1, 1, 1]}
          />
        </View>

        {/* Tips */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Estimated FICO Score Increase</Text>
          {safeArr(data.scoreImprovementTips).length === 0 ? (
            <Text style={styles.small}>No tips available.</Text>
          ) : (
            safeArr(data.scoreImprovementTips).map((tip, i) => (
              <Text key={i} style={styles.bullet}>• {tip}</Text>
            ))
          )}
        </View>

        {/* Alerts */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Flags or Alerts</Text>
          {safeArr(data.alerts).length === 0 ? (
            <Text style={styles.small}>No alerts.</Text>
          ) : (
            safeArr(data.alerts).map((a, i) => (
              <Text key={i} style={styles.bullet}>• {a}</Text>
            ))
          )}
        </View>

        {/* Installments */}
        <View style={styles.card} wrap>
          <Text style={styles.cardHeader}>Non-Revolving Installment Accounts</Text>
          <Table
            headers={[
              'Creditor Name',
              'Account Type',
              'Balance',
              'Monthly Payment',
              'Status',
            ]}
            rows={safeRows(data.installmentAccounts)}
            colWidths={[2, 1.2, 1, 1, 1]}
          />
        </View>

        {/* Footer con paginación */}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `CreditBanc • Confidential • Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )
}
