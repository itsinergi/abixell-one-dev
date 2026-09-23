import html
import zipfile
from pathlib import Path


OUT = Path('Executive_Summary_Roadmap_Network_Phase_2-4.docx')


def esc(value):
    return html.escape(str(value), quote=False)


def run(text, bold=False, italic=False, size=22, color='000000', font='Calibri'):
    props = f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/><w:sz w:val="{size}"/><w:color w:val="{color}"/>'
    if bold:
        props += '<w:b/>'
    if italic:
        props += '<w:i/>'
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def para(text='', style='Normal', before=0, after=120, line=264, align=None, keep=False):
    ppr = f'<w:pStyle w:val="{style}"/><w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>'
    if align:
        ppr += f'<w:jc w:val="{align}"/>'
    if keep:
        ppr += '<w:keepNext/>'
    return f'<w:p><w:pPr>{ppr}</w:pPr>{run(text)}</w:p>'


def rich_para(parts, style='Normal', before=0, after=120, line=264, align=None, keep=False):
    ppr = f'<w:pStyle w:val="{style}"/><w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>'
    if align:
        ppr += f'<w:jc w:val="{align}"/>'
    if keep:
        ppr += '<w:keepNext/>'
    content = ''.join(run(*part) for part in parts)
    return f'<w:p><w:pPr>{ppr}</w:pPr>{content}</w:p>'


def bullet(text, num_id=1):
    return f'<w:p><w:pPr><w:pStyle w:val="Normal"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr><w:spacing w:after="90" w:line="264" w:lineRule="auto"/></w:pPr>{run(text)}</w:p>'


def number(text, num_id=2):
    return f'<w:p><w:pPr><w:pStyle w:val="Normal"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr><w:spacing w:after="90" w:line="264" w:lineRule="auto"/></w:pPr>{run(text)}</w:p>'


def cell(text, width, fill=None, bold=False, color='000000'):
    shd = f'<w:shd w:fill="{fill}"/>' if fill else ''
    return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tcMar>{shd}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{run(text, bold=bold, size=19, color=color)}</w:p></w:tc>'


def table(headers, rows, widths, header_fill='0B2545'):
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    head = '<w:tr>' + ''.join(cell(h, widths[i], header_fill, True, 'FFFFFF') for i, h in enumerate(headers)) + '</w:tr>'
    body = ''.join('<w:tr>' + ''.join(cell(v, widths[i], 'E8EEF5' if i == 0 else None, i == 0, '0B2545' if i == 0 else '000000') for i, v in enumerate(row)) + '</w:tr>' for row in rows)
    borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C2D0"/><w:left w:val="single" w:sz="4" w:color="B7C2D0"/><w:bottom w:val="single" w:sz="4" w:color="B7C2D0"/><w:right w:val="single" w:sz="4" w:color="B7C2D0"/><w:insideH w:val="single" w:sz="4" w:color="D7DEE7"/><w:insideV w:val="single" w:sz="4" w:color="D7DEE7"/></w:tblBorders>'
    return f'<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/>{borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{head}{body}</w:tbl>'


def callout(label, text, fill='EAF3EE', accent='1F6B45'):
    return table([''], [[label + '  ' + text]], [9360], fill).replace(run(label + '  ' + text, size=19), run(label, bold=True, size=19, color=accent) + run('  ' + text, size=19, color='0B2545'))


def heading(text, level=1):
    return para(text, f'Heading{level}', before={1:320, 2:240, 3:160}[level], after={1:160, 2:100, 3:80}[level], line=264, keep=True)


body = []
body.append(rich_para([('EXECUTIVE SUMMARY', False, False, 20, '2E74B5')], after=100))
body.append(rich_para([('Roadmap Infrastruktur Jaringan\nPhase 2 sampai Phase 4', True, False, 50, '0B2545')], after=100, line=300))
body.append(rich_para([('Network Control, Central Monitoring, dan Integrasi Multi-Site', False, False, 26, '5B6573')], after=260))
for label, value in [
    ('Tujuan', 'Menyediakan arah implementasi jaringan yang aman, terukur, dan scalable.'),
    ('Cakupan', 'Workshop infrastructure, central monitoring, remote management, dan multi-site integration.'),
    ('Status', 'Rekomendasi untuk pengambilan keputusan dan perencanaan implementasi.'),
]:
    body.append(rich_para([(label + ': ', True, False, 21, '0B2545'), (value, False, False, 21, '000000')], after=55))
body.append(callout('REKOMENDASI UTAMA', 'Prioritaskan Phase 2 sebagai fondasi pengendalian dan keamanan jaringan. Setelah standar VLAN, firewall, IP addressing, dan dokumentasi stabil, lanjutkan ke Phase 3 untuk monitoring terpusat, kemudian Phase 4 untuk konektivitas antar-lokasi.'))
body.append(heading('1. Ringkasan Eksekutif'))
body.append(para('Roadmap Phase 2 sampai Phase 4 mengubah jaringan workshop dari infrastruktur yang berfungsi secara lokal menjadi platform yang aman, dapat dipantau, dan siap terintegrasi antar-lokasi. Perubahan ini penting untuk mengurangi downtime, mempercepat penanganan insiden, membatasi risiko keamanan, serta menyediakan dasar bagi ekspansi operasional.'))
body.append(para('Investasi sebaiknya dilakukan bertahap. Phase 2 menghasilkan kontrol dasar dan segmentasi. Phase 3 menambahkan kemampuan operasi proaktif melalui monitoring dan remote administration. Phase 4 menghubungkan seluruh site dengan kebijakan keamanan dan manajemen yang konsisten.'))
body.append(heading('2. Roadmap Keputusan'))
body.append(table(['Tahap', 'Fokus', 'Hasil Bisnis/Teknis', 'Prioritas'], [
    ('Phase 2', 'Network Control & Security', 'Menata dan mengamankan fondasi jaringan melalui managed core, VLAN, firewall, dan kebijakan akses.', 'Segera / prioritas berikutnya'),
    ('Phase 3', 'Central Monitoring & Remote Management', 'Membangun visibilitas terpusat, alert otomatis, backup konfigurasi, dan administrasi jarak jauh yang aman.', 'Rekomendasi masa depan'),
    ('Phase 4', 'Multi-Site Integration', 'Menghubungkan HO, BO, mining site, dan nickel site dengan VPN, routing, redundansi, serta central IT management.', 'Arah jangka panjang'),
], [1050, 2200, 4300, 1810]))
body.append(heading('3. Prioritas Phase 2 - Network Control & Security'))
body.append(para('Phase 2 merupakan fondasi teknis yang harus diselesaikan sebelum monitoring dan integrasi multi-site dilakukan. Fokusnya adalah standardisasi arsitektur, pembatasan akses, dan pengurangan ketergantungan pada konfigurasi perangkat yang tidak terdokumentasi.'))
body.append(heading('Kapabilitas yang dibangun', 2))
for t in [
    'Managed core network menggunakan switch Layer 2/Layer 3, firewall/router, rack, UPS, dan backbone yang terdokumentasi.',
    'Network segmentation melalui VLAN terpisah untuk user, CCTV, server/NVR, guest Wi-Fi, management, dan perangkat workshop/IoT.',
    'Pemisahan akses antara CCTV, user, dan administrator; akses antar-segment hanya dibuka sesuai kebutuhan bisnis.',
    'Basic security policy: SSH/HTTPS, MFA bila tersedia, password unik, firmware management, backup konfigurasi, dan port unused yang dinonaktifkan.',
]: body.append(bullet(t))
body.append(heading('Contoh target teknis', 2))
body.append(para('VLAN 20 untuk user, VLAN 30 untuk CCTV, VLAN 40 untuk guest, VLAN 50 untuk server/NVR, VLAN 60 untuk IoT/workshop, dan VLAN 10 untuk management. Guest hanya mendapatkan akses internet; CCTV hanya berkomunikasi dengan NVR; administrator mengakses perangkat melalui management VLAN.'))
body.append(callout('KEPUTUSAN YANG DIPERLUKAN', 'Menyetujui standar VLAN, IP addressing, firewall policy, perangkat managed, serta penanggung jawab perubahan konfigurasi.', 'FFF7E6', '9A6A00'))
body.append(heading('4. Prioritas Phase 3 - Central Monitoring & Remote Management'))
body.append(para('Phase 3 mengubah operasi jaringan dari reaktif menjadi proaktif. Tim IT memperoleh satu tampilan untuk memantau availability, performa, kesehatan perangkat, kapasitas, dan kejadian keamanan.'))
body.append(heading('Kapabilitas yang dibangun', 2))
for t in [
    'Centralized monitoring menggunakan NMS seperti Zabbix, PRTG, LibreNMS, atau platform vendor.',
    'Monitoring SNMPv3, ICMP, Syslog, dan bila diperlukan NetFlow/sFlow untuk status perangkat, bandwidth, error port, suhu, storage NVR, dan client Wi-Fi.',
    'Automatic alerts melalui email, Teams, Slack, Telegram, atau sistem ticketing dengan klasifikasi warning dan critical.',
    'Secure remote administration melalui VPN, MFA, bastion/jump server, role-based access, dan audit log.',
    'Backup konfigurasi otomatis serta change management agar setiap perubahan dapat dilacak dan dipulihkan.',
]: body.append(bullet(t))
body.append(heading('Contoh indikator dashboard', 2))
body.append(para('Availability jaringan 99,8%; perangkat online 48/50; kamera online 15/16; packet loss di bawah 1%; storage NVR di bawah 85%; dan seluruh sesi VPN administrator tercatat.'))
body.append(heading('5. Prioritas Phase 4 - Multi-Site Integration'))
body.append(para('Phase 4 menyediakan konektivitas aman antara Head Office, Branch Office, Mining Site, Nickel Site, dan lokasi lain. Arsitektur ini harus mendukung pertumbuhan jumlah site tanpa mengulang desain dari awal.'))
body.append(heading('Kapabilitas yang dibangun', 2))
for t in [
    'Site-to-site VPN berbasis IPsec atau SD-WAN untuk mengamankan komunikasi antar-lokasi.',
    'IP addressing dan routing plan yang konsisten, misalnya 10.1.0.0/16 untuk HO, 10.2.0.0/16 untuk BO, 10.3.0.0/16 untuk Mining, dan 10.4.0.0/16 untuk Nickel Site.',
    'Central IT management untuk firewall, switch, access point, VPN, monitoring, logging, dan firmware.',
    'Redundansi koneksi menggunakan dual ISP, fiber plus 4G/5G, radio link, microwave, atau VSAT sesuai kondisi lokasi.',
    'Pemisahan jaringan IT, OT, CCTV, guest, dan management dengan prinsip least privilege dan Zero Trust.',
]: body.append(bullet(t))
body.append(heading('6. Manfaat Bisnis', 1))
body.append(table(['Manfaat', 'Dampak yang Diharapkan'], [
    ('Resiliensi operasional', 'Downtime lebih cepat terdeteksi dan dipulihkan.'),
    ('Keamanan', 'Segmentasi dan kebijakan akses membatasi penyebaran insiden.'),
    ('Efisiensi IT', 'Troubleshooting dan administrasi dapat dilakukan dari pusat.'),
    ('Skalabilitas', 'Site baru dapat mengikuti standar IP, VLAN, VPN, dan monitoring yang sama.'),
    ('Governance', 'Perubahan, log, backup, dan performa memiliki jejak audit yang jelas.'),
], [2500, 6860]))
body.append(heading('7. Risiko dan Mitigasi', 1))
body.append(table(['Risiko', 'Mitigasi'], [
    ('Perubahan mengganggu operasional', 'Lakukan maintenance window, backup konfigurasi, dan rollback plan.'),
    ('Kapasitas link tidak mencukupi', 'Ukur baseline trafik dan siapkan QoS serta link cadangan.'),
    ('Akses remote disalahgunakan', 'Gunakan VPN, MFA, RBAC, allowlist, dan audit log.'),
    ('Ketergantungan pada satu vendor', 'Dokumentasikan standar terbuka dan evaluasi interoperabilitas.'),
    ('Perangkat lama tidak mendukung segmentasi', 'Migrasikan bertahap dan gunakan firewall/ACL sebagai kontrol sementara.'),
], [3000, 6360]))
body.append(heading('8. Rekomendasi Tindak Lanjut', 1))
for t in [
    'Validasi kondisi existing: perangkat, topologi, IP address, kapasitas link, CCTV, Wi-Fi, dan kebutuhan tiap lokasi.',
    'Tetapkan standar Phase 2: VLAN, subnet, firewall rule, naming convention, akses admin, dan format dokumentasi.',
    'Implementasikan pilot pada satu area workshop sebelum roll-out ke seluruh area.',
    'Bangun monitoring Phase 3 setelah perangkat utama memiliki konfigurasi dan identitas yang konsisten.',
    'Susun blueprint Phase 4 setelah kebutuhan antar-site, pilihan link, SLA, dan skenario failover disetujui.',
]: body.append(number(t))
body.append(callout('KESIMPULAN', 'Phase 2 adalah prioritas implementasi karena menjadi fondasi keamanan dan kontrol. Phase 3 memberikan operational excellence melalui monitoring dan remote management. Phase 4 menjadi arah jangka panjang untuk jaringan yang scalable, terintegrasi, dan siap mendukung operasi multi-site.'))


document_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>{''.join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1224" w:bottom="1008" w:left="1224" w:header="504" w:footer="504"/><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr></w:body></w:document>'''

styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="32"/><w:color w:val="2E74B5"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="26"/><w:color w:val="2E74B5"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="24"/><w:color w:val="0B2545"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr></w:style>
</w:styles>'''

numbering_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>'''

header_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="17"/><w:color w:val="5B6573"/></w:rPr><w:t>Roadmap Infrastruktur Jaringan</w:t></w:r></w:p></w:hdr>'''
footer_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="17"/><w:color w:val="5B6573"/></w:rPr><w:t>Executive Summary | 26 Agustus 2026</w:t></w:r></w:p></w:ftr>'''

rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'''
content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'''
root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', root_rels)
    z.writestr('word/document.xml', document_xml)
    z.writestr('word/styles.xml', styles_xml)
    z.writestr('word/numbering.xml', numbering_xml)
    z.writestr('word/header1.xml', header_xml)
    z.writestr('word/footer1.xml', footer_xml)
    z.writestr('word/_rels/document.xml.rels', rels)
print(OUT)
