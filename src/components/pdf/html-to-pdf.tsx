import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { parseDocument } from 'htmlparser2';

const styles = StyleSheet.create({
  page: {
    padding: 20,
    fontSize: 12,
    fontFamily: 'Helvetica'
  },
  section: {
    marginBottom: 10
  },
  heading: {
    fontWeight: 'bold',
    marginBottom: 5
  },
  paragraph: {
    marginBottom: 5
  },
  table: {
    width: 'auto',
    marginBottom: 10
  },
  tableRow: {
    flexDirection: 'row'
  },
  tableCell: {
    padding: 4,
    borderWidth: 1,
    borderColor: '#000',
    flex: 1
  }
});

function getText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.data;
  if (node.children) return node.children.map(getText).join('');
  return '';
}

function renderNode(node: any, key: number): React.ReactElement | null {
  if (!node) return null;

  switch (node.type) {
    case 'text':
      return <Text key={key}>{node.data}</Text>;

    case 'tag':
      switch (node.name) {
        case 'p':
          return (
            <Text key={key} style={styles.paragraph}>
              {node.children?.map((child: any, idx: number) => renderNode(child, idx))}
            </Text>
          );
        case 'strong':
        case 'b':
          return (
            <Text key={key} style={{ fontWeight: 'bold' }}>
              {node.children?.map((child: any, idx: number) => renderNode(child, idx))}
            </Text>
          );
        case 'br':
          return <Text key={key}>{'\n'}</Text>;
        case 'ul':
          return (
            <View key={key} style={styles.section}>
              {node.children?.map((li: any, idx: number) => (
                <Text key={idx}>• {getText(li)}</Text>
              ))}
            </View>
          );
        case 'table':
          return (
            <View key={key} style={styles.table}>
              {node.children
                .filter((n: any) => n.name === 'tr')
                .map((row: any, rowIdx: number) => (
                  <View key={rowIdx} style={styles.tableRow}>
                    {row.children
                      .filter((n: any) => n.name === 'td' || n.name === 'th')
                      .map((cell: any, cellIdx: number) => (
                        <Text key={cellIdx} style={styles.tableCell}>
                          {getText(cell)}
                        </Text>
                      ))}
                  </View>
                ))}
            </View>
          );
        case 'img':
          return null;
        default:
          return (
            <View key={key}>
              {node.children?.map((child: any, idx: number) => renderNode(child, idx))}
            </View>
          );
      }

    default:
      return null;
  }
}
const HtmlToPDF = ({ html }: { html: string }) => {
  const parsed = parseDocument(html).children;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {parsed.map((node, index) => (
          <View key={index}>{renderNode(node, index)}</View>
        ))}
      </Page>
    </Document>
  );
};

export default HtmlToPDF;