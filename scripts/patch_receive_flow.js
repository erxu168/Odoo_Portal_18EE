#!/usr/bin/env node
/**
 * Patch script: Adds receive-review flow to purchase page.tsx
 * Run from /opt/krawings-portal:
 *   node patch_receive_flow.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src/app/purchase/page.tsx');
let content = fs.readFileSync(FILE, 'utf8');
const original = content;

function replace(search, replacement, label) {
  if (!content.includes(search)) {
    console.error('FAILED: Could not find marker for "' + label + '"');
    console.error('  Search starts with: ' + JSON.stringify(search).slice(0, 100));
    process.exit(1);
  }
  content = content.replace(search, replacement);
  console.log('OK: ' + label);
}

// 1. Add ReceiveReview import after Numpad import
replace(
  "import Numpad from '@/components/ui/Numpad';",
  "import Numpad from '@/components/ui/Numpad';\nimport ReceiveReview from '@/components/purchase/ReceiveReview';",
  'Add ReceiveReview import'
);

// 2. Add receive-review to Screen type
replace(
  "'receive-check' | 'receive-issue' | 'history'",
  "'receive-check' | 'receive-issue' | 'receive-review' | 'history'",
  'Add receive-review to Screen type'
);

// 3. Add checkedLines state after issuePhoto state
replace(
  "const [issuePhoto, setIssuePhoto] = useState<string>('');",
  "const [issuePhoto, setIssuePhoto] = useState<string>('');\n  const [checkedLines, setCheckedLines] = useState<Record<number, boolean>>({});",
  'Add checkedLines state'
);

// 4. Reset checkedLines when opening receive check
replace(
  "setSelectedOrder(order); setScreen('receive-check');",
  "setSelectedOrder(order); setScreen('receive-check'); setCheckedLines({});",
  'Reset checkedLines in openReceiveCheck'
);

// 5. Add toggleCheckLine function before openOrderDetail
replace(
  'async function openOrderDetail(order: Order)',
  'function toggleCheckLine(lineId: number) { setCheckedLines(prev => ({ ...prev, [lineId]: !prev[lineId] })); }\n\n  async function openOrderDetail(order: Order)',
  'Add toggleCheckLine function'
);

// 6. Replace ReceiveCheck bottom bar (manager confirm buttons -> Review receipt CTA)
var startMarker = '{isManager ? (<><div className="flex gap-2 mb-2"><button onClick={() => setConfirmDialog({ title: \'Confirm receipt?\'';
var endMarker = ') : (<p className="text-[12px] text-gray-500 text-center py-2">A manager must confirm receipt to update stock.</p>)}';

var startIdx = content.indexOf(startMarker);
var endIdx = content.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.error('FAILED: Could not find ReceiveCheck bottom bar markers');
  console.error('  startMarker found: ' + (startIdx !== -1));
  console.error('  endMarker found: ' + (endIdx !== -1));
  process.exit(1);
}

var newBottom = '{(() => {\n' +
  '          const filledCount = receiptLines.filter(l => l.received_qty !== null).length;\n' +
  '          const pct = receiptLines.length > 0 ? Math.round((filledCount / receiptLines.length) * 100) : 0;\n' +
  '          return (<>\n' +
  '            <div className="flex justify-between items-center mb-2">\n' +
  '              <span className="text-[11px] text-gray-500">{filledCount}/{receiptLines.length} items checked</span>\n' +
  '              <span className="text-[11px] font-mono font-bold text-[#1F2933]">{pct}%</span>\n' +
  '            </div>\n' +
  '            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">\n' +
  '              <div className={`h-full rounded-full transition-all duration-300 ${filledCount === receiptLines.length ? \'bg-green-500\' : \'bg-orange-500\'}`} style={{ width: `${pct}%` }} />\n' +
  '            </div>\n' +
  '            <button onClick={() => setScreen(\'receive-review\')} className="w-full py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 active:scale-[0.975] transition-all">\n' +
  '              Review receipt \\u2192\n' +
  '            </button>\n' +
  '          </>);\n' +
  '        })()}';

content = content.slice(0, startIdx) + newBottom + content.slice(endIdx + endMarker.length);
console.log('OK: Replace ReceiveCheck bottom bar with Review receipt CTA');

// 7. Add receive-review screen routing in render section
replace(
  ') : screen === \'receive-issue\' ? (<><Header title="Report issue" showBack onBack={() => setScreen(\'receive-check\')} /><ReceiveIssue />',
  ') : screen === \'receive-review\' ? (<><Header title="Review receipt" subtitle={selectedOrder?.supplier_name} showBack onBack={() => setScreen(\'receive-check\')} /><ReceiveReview receiptLines={receiptLines} checkedLines={checkedLines} onToggleCheck={toggleCheckLine} recvOrder={recvOrder} receipt={receipt} isManager={isManager} onConfirm={confirmReceiptAction} onBack={() => setScreen(\'receive-check\')} onSetConfirmDialog={setConfirmDialog} /></>\n      ) : screen === \'receive-issue\' ? (<><Header title="Report issue" showBack onBack={() => setScreen(\'receive-check\')} /><ReceiveIssue />',
  'Add receive-review screen routing'
);

// Write the patched file
fs.writeFileSync(FILE, content, 'utf8');
console.log('\nDone! Patched ' + FILE);
console.log('  Original: ' + original.length + ' chars');
console.log('  Patched:  ' + content.length + ' chars');
console.log('  Diff:     +' + (content.length - original.length) + ' chars');
console.log('\nNext steps:');
console.log('  npm run build');
console.log('  systemctl restart krawings-portal');
