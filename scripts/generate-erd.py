#!/usr/bin/env python3
"""Generate a vector PDF/SVG ERD from SmartShop's actual SQLite schema.

Run with the bundled Python runtime (reportlab is required), from any directory.
The schema is obtained from createApp using an in-memory database: no shop data,
passwords, tokens or account details are read or included in the document.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
from xml.sax.saxutils import escape

from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A3, landscape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs'
WIDTH, HEIGHT = landscape(A3)
GREEN = '#176b55'
INK = '#213d34'
MUTED = '#62786e'
LINE = '#7c9e90'
BORDER = '#ceddd5'
PAPER = '#f6f9f6'
BLUE = '#356e99'


def read_schema():
    node = shutil.which('node') or '/opt/homebrew/opt/node@24/bin/node'
    if not Path(node).exists():
        node = '/Users/kawsarahmed/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    source = r'''
import { createApp } from './server/app.ts';
import { mountCommunity } from './server/community.ts';
const instance = createApp({dbPath: ':memory:', seed: false, demo: false});
const {db,app,close} = instance;
if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_comments'").get()) {
  mountCommunity(app, {db,auth:(_q,_s,n)=>n(),optionalAuth:(_q,_s,n)=>n(),notify:()=>{}});
}
const result = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => ({
  name:row.name,sql:row.sql,
  columns:db.prepare(`PRAGMA table_info("${row.name}")`).all(),
  fks:db.prepare(`PRAGMA foreign_key_list("${row.name}")`).all(),
  indexes:db.prepare(`PRAGMA index_list("${row.name}")`).all().filter(i=>i.unique).map(i=>({name:i.name,columns:db.prepare(`PRAGMA index_info("${i.name}")`).all().map(c=>c.name)}))
}));
close();
console.log('SMARTSHOP_SCHEMA_JSON=' + JSON.stringify(result));
'''
    env = dict(os.environ)
    env['NODE_ENV'] = 'test'
    result = subprocess.run([node, '--import', 'tsx', '--input-type=module', '-e', source], cwd=ROOT, env=env, capture_output=True, text=True, check=True)
    prefix = 'SMARTSHOP_SCHEMA_JSON='
    line = next((s for s in result.stdout.splitlines() if s.startswith(prefix)), None)
    if line is None:
        raise RuntimeError('Schema extraction did not produce a JSON result.')
    return {table['name']: table for table in json.loads(line[len(prefix):])}


class Drawing:
    """Write the same vector operations to a PDF page and an SVG group."""
    def __init__(self, pdf):
        self.pdf = pdf
        self.pages: list[list[str]] = []
        self.svg: list[str] = []
    def page(self):
        self.svg = []
        self.pages.append(self.svg)
    def rect(self, x, y, w, h, fill=None, stroke=None, radius=0, width=1):
        c = self.pdf
        c.setLineWidth(width)
        if fill: c.setFillColor(HexColor(fill))
        if stroke: c.setStrokeColor(HexColor(stroke))
        if radius:
            c.roundRect(x, HEIGHT-y-h, w, h, radius, fill=bool(fill), stroke=bool(stroke))
        else:
            c.rect(x, HEIGHT-y-h, w, h, fill=bool(fill), stroke=bool(stroke))
        self.svg.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{radius}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{width}"/>')
    def text(self, x, y, text, size=10, color=INK, bold=False, anchor='start'):
        c = self.pdf
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
        c.setFillColor(HexColor(color))
        method = {'start':c.drawString,'middle':c.drawCentredString,'end':c.drawRightString}[anchor]
        method(x, HEIGHT-y, str(text))
        self.svg.append(f'<text x="{x:.2f}" y="{y:.2f}" fill="{color}" font-size="{size}" font-weight="{700 if bold else 400}" text-anchor="{anchor}" font-family="Arial,Helvetica,sans-serif">{escape(str(text))}</text>')
    def line(self, pts, color=LINE, width=1.25, dash=False):
        c = self.pdf
        c.setStrokeColor(HexColor(color)); c.setLineWidth(width)
        c.setDash(4,3) if dash else c.setDash()
        p = c.beginPath(); p.moveTo(pts[0][0], HEIGHT-pts[0][1])
        for x,y in pts[1:]: p.lineTo(x,HEIGHT-y)
        c.drawPath(p)
        c.setDash()
        points = ' '.join(f'{x:.2f},{y:.2f}' for x,y in pts)
        dash_svg = ' stroke-dasharray="4,3"' if dash else ''
        self.svg.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{dash_svg}/>')
    def circle(self,x,y,r,fill=PAPER,stroke=LINE,width=1.2):
        c=self.pdf; c.setFillColor(HexColor(fill)); c.setStrokeColor(HexColor(stroke)); c.setLineWidth(width)
        c.circle(x,HEIGHT-y,r,fill=1,stroke=1)
        self.svg.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>')
    def save_svg(self,path):
        total = HEIGHT * len(self.pages)
        groups = ''.join(f'<g transform="translate(0,{i*HEIGHT:.2f})">'+''.join(page)+'</g>' for i,page in enumerate(self.pages))
        Path(path).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH:.2f}" height="{total:.2f}" viewBox="0 0 {WIDTH:.2f} {total:.2f}"><title>SmartShop database ERD</title><desc>Vector entity relationship diagram generated from the actual SQLite schema. Each panel corresponds to one printable A3 landscape PDF page.</desc>{groups}</svg>')


NOTES = {
    'users':['Role: owner / staff / customer.','Contact verification comes from Firebase.'],
    'shop':['Singleton: id must equal 1.','Owner-managed contact and map settings.','map_location_set controls nullable map output.'],
    'products':['Money stored as integer paisa.','Image asset relationship continues on p2.'],
    'customers':['Optional user_id links a login profile.','opening_due is prior debt, not sales revenue.'],
    'sales':['customer_id is optional for walk-in sales.','Cost is a sale-time snapshot.'],
    'sale_items':['Unit price and unit cost are snapshots.'],
    'purchases':['One stock-receipt line per record.'],
    'stock_movements':['reference_id is application-managed;','it is not a declared SQL foreign key.'],
    'reviews':['Rating: 1-5. One review per product/user.'],
    'product_comments':['Shared discussion, visible to all visitors.'],
    'comment_reactions':['Composite PK: comment_id + user_id.','Value: +1 like / -1 dislike.'],
    'requests':['Composite PK: kind + request_id.','Stores idempotency response and digest.'],
    'activity':['Display/audit feed; detail is text.'],
    'expenses':['Expense date is separate from timestamp.'],
    'user_sessions':['Only refresh-token hashes are stored.','JWT access lasts one day; refresh is revocable.','Parallel refreshes share a 30-second grace.'],
    'uploads':['File bytes live on the selected provider.'],
    'customer_receipts':['A collection reduces existing customer dues.','opening_amount is included in amount.','Methods: cash / bkash / nagad / bank / other.'],
    'receipt_allocations':['Composite PK: receipt_id + sale_id.','Each allocation amount is positive.'],
    'stock_alert_reads':['Composite PK: user_id + product_id.','Read snapshot is specific to this user.'],
}

class Table:
    def __init__(self,name,x,y,w=250):
        self.name=name; self.x=x; self.y=y; self.w=w
        self.rows={}; self.h=0
    def draw(self,d,schema):
        t=schema[self.name]; columns=t['columns']; fk={f['from']:f for f in t['fks']}
        notes=NOTES.get(self.name,[])
        constraints=[]
        for index in t['indexes']:
            # Composite primary keys are already marked in the field list.
            primary={c['name'] for c in columns if c['pk']}
            if set(index['columns'])==primary and primary: continue
            constraints.append('UNIQUE: '+', '.join(index['columns']))
        footer=constraints+notes
        self.h=37+14.8*len(columns)+10+12*len(footer)
        if self.y+self.h > HEIGHT-91:
            raise ValueError(f'{self.name} card extends into the page notes/footer area.')
        d.rect(self.x,self.y,self.w,self.h,fill='#ffffff',stroke=BORDER,radius=7)
        d.rect(self.x,self.y,self.w,33,fill=GREEN,radius=7)
        d.rect(self.x,self.y+23,self.w,10,fill=GREEN)
        d.text(self.x+12,self.y+22,self.name,12.5,'#ffffff',True)
        for i,c in enumerate(columns):
            yy=self.y+49+i*14.8; self.rows[c['name']]=yy-3
            key='PK' if c['pk'] else 'FK' if c['name'] in fk else ''
            unique=any(index['columns']==[c['name']] for index in t['indexes'])
            if key:
                d.rect(self.x+10,yy-9,22,12,fill='#e5efe9' if key=='PK' else '#e9f0f7',radius=3)
                d.text(self.x+21,yy,key,7.3,GREEN if key=='PK' else BLUE,True,'middle')
            if c['pk'] and c['name'] in fk:
                d.text(self.x+34,yy,'FK',6.5,BLUE,True)
            d.text(self.x+49,yy,c['name'],9.2,INK,bold=bool(c['pk']))
            typ=c['type'].replace('INTEGER','INT')
            d.text(self.x+self.w-29,yy,typ,7.8,MUTED,anchor='end')
            flag=('U' if unique else '')+('?' if not(c['notnull'] or c['pk']) else '')
            if flag: d.text(self.x+self.w-10,yy,flag,8.2,MUTED,True,'end')
        fy=self.y+37+14.8*len(columns)+9
        if footer:
            d.line([(self.x+10,fy-4),(self.x+self.w-10,fy-4)],BORDER,.6)
        for line in footer:
            d.text(self.x+12,fy+9,line,7.8,MUTED)
            fy+=12
        return self
    def port(self,field,side='right'):
        return (self.x+(self.w if side=='right' else 0),self.rows[field])


def label(d,x,y,text,color=GREEN):
    w=max(17,len(text)*4.5+9)
    d.rect(x-w/2,y-7,w,12,fill=PAPER,radius=3)
    d.text(x,y+1,text,7.7,color,True,'middle')

def marker(d,p,neighbor,many=False,optional=False):
    dx=neighbor[0]-p[0];dy=neighbor[1]-p[1];length=math.hypot(dx,dy)
    ux,uy=dx/length,dy/length;px,py=-uy,ux
    if many:
        stem=(p[0]+ux*10,p[1]+uy*10)
        d.line([(p[0]+px*5,p[1]+py*5),stem,(p[0]-px*5,p[1]-py*5)],GREEN,1.1)
        if optional:d.circle(p[0]+ux*18,p[1]+uy*18,3)
    else:
        cx,cy=p[0]+ux*8,p[1]+uy*8
        d.line([(cx+px*5,cy+py*5),(cx-px*5,cy-py*5)],GREEN,1.1)
        if optional:d.circle(p[0]+ux*17,p[1]+uy*17,3)

def relation(d,pts,parent_optional=False,text=None,label_pos=None):
    d.line(pts,GREEN,1.15)
    marker(d,pts[0],pts[1],optional=parent_optional)
    marker(d,pts[-1],pts[-2],many=True,optional=True)
    if text and label_pos:label(d,*label_pos,text)

def header(d,page,title,subtitle):
    d.rect(0,0,WIDTH,HEIGHT,fill=PAPER)
    d.rect(35,30,42,5,fill=GREEN,radius=2)
    d.text(35,64,'SmartShop',25,GREEN,True)
    d.text(183,63,'DATABASE ERD',11,MUTED,True)
    d.text(WIDTH-35,48,f'CLASS DEMONSTRATION  /  {page:02d}',9,MUTED,True,'end')
    d.text(35,94,title,16,INK,True)
    d.text(35,113,subtitle,9.2,MUTED)

def footer(d,page,total):
    d.line([(35,HEIGHT-65),(WIDTH-35,HEIGHT-65)],BORDER,.75)
    d.text(35,HEIGHT-47,'PK  Primary key     FK  Declared foreign key     U  Unique     ?  Nullable',8.4,MUTED)
    d.text(35,HEIGHT-32,'Cardinality: | = one; circle = optional; crow foot = many. Solid connectors show declared SQL foreign keys.',8.2,MUTED)
    d.text(WIDTH-35,HEIGHT-32,f'{page} / {total}   |   05 NOV 2026',8.3,MUTED,True,'end')

def reference(d,name,fields,x,y,w=225,page=1):
    """A clearly labelled repeated key stub, not an additional entity."""
    height=44+len(fields)*18
    d.rect(x,y,w,height,fill='#edf3ee',stroke=BORDER,radius=7)
    d.text(x+12,y+20,name,12,GREEN,True)
    d.text(x+w-12,y+20,f'REFERENCE / p{page}',7.5,MUTED,True,'end')
    ports={}
    for i,field in enumerate(fields):
        yy=y+43+i*18;ports[field]=yy-3
        d.text(x+12,yy,field,9,INK,bold=field=='id')
    return {'left':lambda field:(x,ports[field]),'right':lambda field:(x+w,ports[field])}

def render(schema):
    expected={'users','shop','products','customers','sales','sale_items','purchases','expenses','stock_movements','reviews','activity','requests','product_comments','comment_reactions','user_sessions','uploads','customer_receipts','receipt_allocations','stock_alert_reads'}
    extra=set(schema)-expected
    if extra:raise ValueError(f'Unplaced schema tables must be assigned a position: {sorted(extra)}')
    OUT.mkdir(exist_ok=True)
    pdf=canvas.Canvas(str(OUT/'SmartShop_ERD.pdf'),pagesize=(WIDTH,HEIGHT),pageCompression=1)
    pdf.setTitle('SmartShop - Database Entity Relationship Diagram')
    pdf.setAuthor('SmartShop Development')
    pdf.setSubject('Schema-derived relational ERD, inventory/accounting, identity/community and customer collections')
    d=Drawing(pdf)
    all_tables={}

    d.page();header(d,1,'Inventory, sales and accounting',f'{len(schema)} actual SQLite entities / {sum(len(t["fks"]) for t in schema.values())} declared foreign keys. Pages 2-3: profiles, discussions, collections and settings.')
    positions={'customers':(35,153,238),'sales':(314,153,238),'sale_items':(593,153,238),'products':(872,153,283),'activity':(35,433,238),'expenses':(314,433,238),'purchases':(593,433,238),'stock_movements':(872,516,283)}
    ts={n:Table(n,*pos).draw(d,schema) for n,pos in positions.items() if n in schema};all_tables.update(ts)
    relation(d,[ts['customers'].port('id'),ts['sales'].port('customer_id','left')],True)
    relation(d,[ts['sales'].port('id'),ts['sale_items'].port('sale_id','left')])
    p=ts['products'].port('id','left');q=ts['sale_items'].port('product_id')
    relation(d,[p,(852,p[1]),(852,q[1]),q])
    q=ts['purchases'].port('product_id');relation(d,[p,(847,p[1]),(847,q[1]),q])
    p=ts['products'].port('id');q=ts['stock_movements'].port('product_id')
    relation(d,[p,(1172,p[1]),(1172,q[1]),q])
    d.text(593,687,'ACCOUNTING NOTES',8.6,GREEN,True)
    d.text(593,703,'Gross profit = sales revenue - sale-time goods cost.',8.8,MUTED)
    d.text(593,718,'Net profit = gross profit - dated expenses.',8.8,MUTED)
    d.text(593,733,'Opening dues and later customer receipts continue on p3.',8.8,MUTED)
    d.text(35,747,'No fabricated FK is drawn for stock movement references, the shop singleton or independent expense records.',8.4,MUTED)
    footer(d,1,3);pdf.showPage()

    d.page();header(d,2,'Identity, community and photo metadata','Firebase verifies contacts. Profiles and ledger contacts are linked optionally; photo bytes use local or remote storage.')
    positions={'users':(35,153,250),'uploads':(323,153,250),'user_sessions':(323,405,250),'reviews':(611,153,250),'product_comments':(611,430,250),'comment_reactions':(899,153,256),'requests':(899,381,256)}
    ts={n:Table(n,*pos).draw(d,schema) for n,pos in positions.items() if n in schema};all_tables.update(ts)
    if 'uploads' in ts:
        relation(d,[ts['users'].port('id'),ts['uploads'].port('user_id','left')])
        p=ts['uploads'].port('id','left');q=ts['users'].port('avatar_upload_id')
        relation(d,[p,(311,p[1]),(311,q[1]),q],True)
    if 'user_sessions' in ts:
        p=ts['users'].port('id');q=ts['user_sessions'].port('user_id','left')
        relation(d,[p,(301,p[1]),(301,q[1]),q])
    # Route identity links through the horizontal corridor between upper and lower cards.
    p=ts['users'].port('id');q=ts['reviews'].port('user_id','left')
    relation(d,[p,(296,p[1]),(296,379),(590,379),(590,q[1]),q])
    q=ts['product_comments'].port('user_id','left')
    relation(d,[p,(296,p[1]),(296,379),(590,379),(590,q[1]),q])
    p=ts['users'].port('id','left');q=ts['comment_reactions'].port('user_id')
    relation(d,[p,(20,p[1]),(20,132),(1172,132),(1172,q[1]),q])
    p=ts['product_comments'].port('id');q=ts['comment_reactions'].port('comment_id','left')
    relation(d,[p,(880,p[1]),(880,q[1]),q])
    # Explicit page-boundary references preserve the main graph without duplicate entities.
    d.rect(35,527,250,185,fill='#edf3ee',stroke=BORDER,radius=7)
    d.text(48,550,'CROSS-PAGE FOREIGN KEYS',9.5,GREEN,True)
    y=571
    references=[('reviews.product_id','products.id  [p1]'),('product_comments.product_id','products.id  [p1]'),('customers.user_id  [p1]','users.id')]
    if any(f['from']=='upload_id' for f in schema['products']['fks']):references.append(('products.upload_id  [p1]','uploads.id'))
    for start,end in references:
        d.text(48,y,start,8.3,INK,True);d.text(48,y+13,'references '+end,8.1,MUTED);y+=32
    d.text(611,640,'ACCESS AND SESSION RULES',9,GREEN,True)
    d.text(611,659,'Only an owner can grant or revoke staff access.',8.9,MUTED)
    d.text(611,676,'Every API call resolves the current database role.',8.9,MUTED)
    d.text(611,693,'Explicit logout revokes the access/refresh session.',8.9,MUTED)
    d.text(611,710,'Refresh secrets and account passwords are never shown.',8.9,MUTED)
    d.text(35,747,'One user can have many sessions, reviews, comments and reactions; UNIQUE constraints prevent duplicate review/reaction votes.',8.3,MUTED)
    footer(d,2,3);pdf.showPage()

    d.page();header(d,3,'Customer collections, stock alerts and shop settings','Collections reduce existing debt without creating sales. Reference stubs repeat parent keys from earlier pages; they are not extra entities.')
    customers=reference(d,'customers',['id','name','opening_due'],35,153,page=1)
    users=reference(d,'users',['id','name','role'],35,360,page=2)
    products=reference(d,'products',['id','stock','reorder_level'],35,575,page=1)
    sales=reference(d,'sales',['id','customer_id','total','paid'],820,306,w=335,page=1)
    positions={'customer_receipts':(350,153,310),'receipt_allocations':(820,153,335),'stock_alert_reads':(350,548,310),'shop':(820,470,335)}
    ts={n:Table(n,*pos).draw(d,schema) for n,pos in positions.items() if n in schema};all_tables.update(ts)
    if 'customer_receipts' in ts:
        relation(d,[customers['right']('id'),ts['customer_receipts'].port('customer_id','left')])
        p=users['right']('id');q=ts['customer_receipts'].port('user_id','left')
        relation(d,[p,(305,p[1]),(305,q[1]),q])
    if 'receipt_allocations' in ts:
        relation(d,[ts['customer_receipts'].port('id'),ts['receipt_allocations'].port('receipt_id','left')])
        p=sales['left']('id');q=ts['receipt_allocations'].port('sale_id','left')
        relation(d,[p,(772,p[1]),(772,q[1]),q])
    if 'stock_alert_reads' in ts:
        p=users['right']('id');q=ts['stock_alert_reads'].port('user_id','left')
        relation(d,[p,(289,p[1]),(289,q[1]),q])
        relation(d,[products['right']('id'),ts['stock_alert_reads'].port('product_id','left')])
    d.text(350,411,'LEDGER RULES',9,GREEN,True)
    d.text(350,429,'Payments settle opening debt first, then oldest invoices.',8.9,MUTED)
    d.text(350,446,'opening_amount is part of the receipt amount.',8.9,MUTED)
    d.text(350,463,'sales.paid remains the original checkout snapshot.',8.9,MUTED)
    d.text(350,480,'Collections increase cash received, not sales or profit.',8.9,MUTED)
    d.text(35,747,'All connectors on this page are declared SQL foreign keys. Reference stubs do not increase the unique entity count.',8.5,MUTED)
    footer(d,3,3);pdf.showPage();pdf.save();d.save_svg(OUT/'SmartShop_ERD.svg')

    # If an authentication/upload migration has not landed, say so instead of inventing fields.
    missing=expected-set(schema)
    markdown=['# SmartShop ERD','', 'Generated from the application\'s **actual in-memory SQLite schema** on 5 November 2026.', '',
      '- [Scalable vector PDF](SmartShop_ERD.pdf)', '- [Editable vector SVG](SmartShop_ERD.svg)', '',
      'The PDF uses three A3 landscape pages: inventory/accounting on page 1, identity/community/assets on page 2, and customer collections, stock-alert read history and shop settings on page 3. All labels and connectors are vector elements, so the document can be enlarged without raster blur. Reference stubs on page 3 repeat keys from pages 1/2 and are not additional entities.', '',
      '## Regenerate', '', 'Run `scripts/generate-erd.py` with a Python runtime containing ReportLab. The script loads `createApp` into an isolated in-memory database and reads SQLite table, foreign-key and unique-index metadata. It does not copy customer records, tokens, passwords or production data.', '',
      '## Important modelling decisions','',
      '- `users` are login identities; `customers` are shop ledger contacts. `customers.user_id` optionally joins a registered login to its ledger contact.',
      '- A sale may have no customer for walk-in purchases. When set, `sales.customer_id` references a customer.',
      '- `stock_movements.reference_id` and `activity.detail` are application-managed reference/display data. They are not declared foreign keys.',
      '- `requests` has composite primary key `(kind, request_id)` for transaction idempotency.',
      '- `reviews` is unique per `(product_id, user_id)`; comment reactions have composite primary key `(comment_id, user_id)`.',
      '- `customer_receipts` stores later collections against existing dues; `opening_amount` is the portion applied to the customer\'s opening balance, and `receipt_allocations` connects the rest to sales.',
      '- `receipt_allocations` has composite primary key `(receipt_id, sale_id)`. Collections do not create a new sale.',
      '- `stock_alert_reads` has composite primary key `(user_id, product_id)`, with stock/reorder snapshots at the time that user marked the alert read.',
      '- `customers.opening_due` represents debt recorded before app invoices. Receipts reduce this balance first; only the remainder is allocated FIFO to prior sales.',
      '- `sales.paid` is immutable checkout history. Current invoice settlement is `sales.paid + SUM(receipt_allocations.amount)`; outstanding due subtracts that settlement from the sale total.',
      '- Later collections increase cash received while leaving sales revenue and profit unchanged.',
      '- `user_sessions` stores current/previous refresh-token hashes, never raw secrets. Access JWTs last one day; the persistent session is revoked on explicit logout. A 30-second grace makes concurrent refreshes converge.',
      '- `users.role` is resolved from the database for every authorized request. Only an owner can grant/revoke staff access; the owner account cannot be demoted through that endpoint.',
      '- `shop` is an independent singleton. Its `map_location_set` flag makes the public coordinates nullable without rewriting the original NOT NULL SQLite coordinate fields.',
      '- Firebase handles contact verification. Photo bytes use the configured provider: this free setup uses local files, while SQLite stores upload metadata and profile/product links.',
      '- Currency amounts are integer paisa; timestamps are ISO strings and reporting dates use the shop\'s Dhaka timezone.', '',
      '## Schema audit','',f'Tables represented: **{len(schema)}**. Every declared SQL foreign key is listed below; cross-page references are explicit in the diagram.','',
      '| Child field | Parent key | Optional parent | Delete action |','| --- | --- | --- | --- |']
    for name,t in sorted(schema.items()):
        cols={c['name']:c for c in t['columns']}
        for f in t['fks']:
            markdown.append(f"| `{name}.{f['from']}` | `{f['table']}.{f['to']}` | {'Yes' if not cols[f['from']]['notnull'] else 'No'} | `{f['on_delete']}` |")
    if missing:markdown+=['',f'Not yet present in the source schema at generation time: {", ".join(sorted(missing))}. These entities have not been invented in the diagram; regenerate after the migrations are integrated.']
    markdown+=['','## Entity fields','']
    for name,t in sorted(schema.items()):
        fields=[]
        for c in t['columns']:
            flags=[]
            if c['pk']:flags.append('PK')
            if any(f['from']==c['name'] for f in t['fks']):flags.append('FK')
            if not(c['notnull'] or c['pk']):flags.append('nullable')
            fields.append(f"`{c['name']}` {c['type']}"+(f" ({', '.join(flags)})" if flags else ''))
        markdown.append(f"- **{name}**: "+'; '.join(fields)+'.')
    (OUT/'ERD.md').write_text('\n'.join(markdown)+'\n')
    print(f'Generated vector ERD: {len(schema)} tables, {sum(len(t["fks"]) for t in schema.values())} declared foreign keys, 3 pages.')
    if missing:print('Migration tables not yet present:',', '.join(sorted(missing)))


if __name__=='__main__':
    render(read_schema())
