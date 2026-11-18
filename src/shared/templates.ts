import { between, makeNode, validNode, type Node, type Doc, type Op } from './doc';
import { aabb, intersects, type Point, type Rect } from './geometry';

export interface Template { id: string; name: string; category: string; w: number; h: number; nodes: Node[]; file?: string }

function design(id: string, name: string, category: string, w: number, h: number, fill: string, draw: (b: ReturnType<typeof builder>) => void): Template {
    const b = builder(id, w, h, fill); draw(b);
    b.nodes[0].name = name;
    return { id, name, category, w, h, nodes: b.nodes };
}
function builder(id: string, w: number, h: number, fill: string) {
    const nodes: Node[] = [{ ...makeNode('frame', 0, 0), id: id + '-root', w, h, fill }];
    let index: string | null = null;
    function shape(type: Node['type'], x: number, y: number, w: number, h: number, fill: string, extra: Partial<Node> = {}) {
        index = between(index);
        const node = { ...makeNode(type, x, y, index), id: id + '-' + nodes.length, parent: nodes[0].id, w, h, fill, ...extra };
        nodes.push(node); return node;
    }
    return { nodes, rect: (x: number, y: number, w: number, h: number, c: string, extra: Partial<Node> = {}) => shape('rect', x, y, w, h, c, extra),
        circle: (x: number, y: number, d: number, c: string, extra: Partial<Node> = {}) => shape('ellipse', x, y, d, d, c, extra),
        text: (text: string, x: number, y: number, w: number, size: number, c = '#202921', weight: 400 | 700 = 400, extra: Partial<Node> = {}) => shape('text', x, y, w, size * 1.3 * text.split('\n').length, c, { text, textWidth: 'fixed', fontSize: size, fontWeight: weight, name: text.split('\n')[0], ...extra }) };
}

export const builtInTemplates: Template[] = [
    design('mobile', 'Mobile screen', 'Digital', 390, 844, '#f7f8fa', b => {
        b.text('9:41', 24, 18, 100, 14, '#183c35', 700); b.text('Fieldwork', 24, 72, 320, 34, '#183c35', 700);
        b.text('Your city, on foot.', 24, 118, 330, 18); b.rect(24, 174, 342, 312, '#d5e4b8');
        for (let i = 0; i < 6; i++) b.rect(24, 210 + i * 45, 342, 8, '#edf3de');
        b.rect(100, 174, 12, 312, '#edf3de'); b.rect(266, 174, 12, 312, '#edf3de');
        b.rect(176, 224, 8, 190, '#22664e'); b.rect(176, 406, 104, 8, '#22664e');
        b.circle(164, 214, 32, '#22664e', { stroke: '#ffffff', strokeWidth: 5 }); b.circle(264, 394, 32, '#ed613e', { stroke: '#ffffff', strokeWidth: 5 });
        b.text('Saturday route', 24, 520, 330, 27, '#183c35', 700); b.text('Canal path → Market square', 24, 562, 342, 18);
        b.rect(24, 612, 342, 1, '#b6c4bc'); b.text('4.2 km', 24, 635, 150, 30, '#183c35', 700); b.text('55 min', 210, 635, 150, 30, '#183c35', 700);
        b.text('Mostly flat · Riverside', 24, 682, 340, 16); b.rect(24, 742, 342, 60, '#22664e'); b.text('Start walking  →', 44, 758, 300, 20, '#ffffff', 700);
    }),
    design('landing', 'Landing page', 'Digital', 1440, 1024, '#f5f5f2', b => {
        b.text('Common Press', 64, 36, 500, 30, '#202921', 700); b.text('Editions     About     Visit the shop ↗', 900, 44, 480, 20);
        b.rect(64, 108, 1312, 2, '#202921'); b.text('Independent books.\nUncommon ideas.', 64, 162, 800, 76, '#202921', 700);
        b.text('A small publishing house for people who look closer.\nArt, architecture and everyday life, in print.', 68, 405, 750, 26);
        b.rect(68, 520, 284, 64, '#df4629'); b.text('Explore the editions →', 88, 539, 260, 20, '#ffffff', 700);
        b.rect(962, 170, 350, 432, '#1e594e', { rotation: 8 }); b.rect(918, 186, 330, 418, '#f3b634', { rotation: -6 });
        b.text('Ways\nof\nseeing', 950, 228, 270, 68, '#243c2f', 700, { rotation: -6 }); b.text('Common Press / 004', 956, 542, 260, 16, '#243c2f');
        b.rect(64, 698, 1312, 2, '#202921'); b.text('Fresh off the press', 64, 732, 560, 40, '#202921', 700);
        b.text('004', 64, 840, 150, 60); b.text('Ways of seeing the everyday', 260, 844, 800, 32, '#202921', 700);
        b.text('Essays and photographs · 160 pages · Available now', 260, 901, 900, 22); b.text('€28  ↗', 1220, 848, 160, 26);
    }),
    design('slide', 'Presentation slide', 'Editorial', 1920, 1080, '#ffffff', b => {
        b.rect(0, 0, 28, 1080, '#df422c'); b.text('Northline / Service design', 100, 64, 1200, 30); b.text('2026', 1660, 64, 180, 30);
        b.rect(100, 142, 1720, 3, '#202921'); b.text('A better journey\nstarts at the stop.', 100, 212, 1600, 116, '#202921', 700);
        b.text('Making public transport easier to understand,\nfrom the first glance to the last connection.', 108, 530, 1350, 38);
        b.rect(100, 722, 1720, 3, '#202921'); b.text('01', 100, 778, 230, 110, '#df422c', 700);
        b.text('Research & direction', 460, 790, 920, 52, '#202921', 700); b.text('Passenger experience team\nJune 18, 2026', 466, 888, 1000, 30); b.text('→', 1620, 790, 200, 110, '#df422c');
    }),
    design('social', 'Social post', 'Editorial', 1080, 1080, '#e8ed30', b => {
        b.text('Studio Openhouse', 54, 44, 850, 30, '#144632', 700); b.rect(54, 108, 972, 3, '#144632');
        b.text('Objects\nwith a\nsecond life.', 48, 152, 990, 130, '#144632', 700);
        b.circle(734, 566, 260, '#144632'); b.circle(786, 618, 156, '#e8ed30'); b.rect(724, 686, 280, 20, '#e8ed30', { rotation: -35 });
        b.rect(54, 876, 972, 3, '#144632'); b.text('Repair workshop\nSaturday 24 October, 11–17h', 54, 910, 700, 30, '#144632'); b.text('Bring it.\nFix it.', 830, 910, 210, 30, '#144632', 700);
    }),
    design('poster', 'Poster', 'Print', 1240, 1754, '#e93f2d', b => {
        b.text('Kunsthalle West', 68, 54, 1000, 40, '#ffffff'); b.rect(68, 132, 1104, 3, '#ffffff');
        b.text('Rhythm\n& space', 52, 176, 1160, 180, '#ffffff', 700);
        for (let i = 0; i < 7; i++) b.rect(68 + i * 156, 690 + i * 50, 96, 500 - i * 36, i % 2 ? '#ffffff' : '#292c2a');
        b.rect(68, 1312, 1104, 3, '#ffffff'); b.text('Sound, form and the modern city', 68, 1360, 1100, 44, '#ffffff', 700);
        b.text('12 September —\n08 November 2026', 68, 1460, 600, 40, '#ffffff'); b.text('Tue–Sun 10–18\nWeststrasse 14\nkunsthalle.example', 760, 1464, 420, 32, '#ffffff');
    }),
    design('card', 'Business card', 'Print', 1050, 600, '#e5eaed', b => {
        b.rect(50, 50, 90, 90, '#00685e'); b.circle(74, 74, 42, '#e5eaed'); b.text('Tandem', 174, 48, 780, 76, '#00685e', 700);
        b.rect(50, 190, 950, 2, '#00685e'); b.text('Design for the long run.', 50, 228, 950, 38, '#00685e');
        b.text('Maya Chen', 50, 382, 600, 40, '#00685e', 700); b.text('Industrial designer', 50, 442, 600, 28, '#00685e');
        b.text('maya@tandem.example\n+44 20 7946 0328\ntandem.example', 656, 386, 360, 24, '#00685e');
        b.rect(50, 540, 950, 2, '#00685e');
    }),
];

export function insertionOps(template: Template, doc: Doc, parent: string | null, center: Point, occupied?: Rect[], initialKey?: string): { ops: Op[]; root: Node } {
    const rectangles = occupied ?? [...doc.values()].filter(n => n.type !== 'page' && n.parent === parent).map(n => aabb(doc, n));
    const box = { x: center.x - template.w / 2, y: center.y - template.h / 2, w: template.w, h: template.h };
    while (true) {
        const collisions = rectangles.filter(r => intersects({ x: box.x - 64, y: box.y - 64, w: box.w + 128, h: box.h + 128 }, r));
        if (!collisions.length) break;
        box.x = Math.max(...collisions.map(r => r.x + r.w)) + 80;
    }
    const ids = new Map(template.nodes.map((n, i) => [n.id, initialKey ? `${initialKey}:template:${template.id}:${i}` : crypto.randomUUID()]));
    const nodes = structuredClone(template.nodes).map(n => ({ ...n, id: ids.get(n.id)!, parent: n.parent ? ids.get(n.parent)! : parent }));
    const root = nodes[0]; root.x = box.x; root.y = box.y;
    root.index = between([...doc.values()].filter(n => n.parent === parent).map(n => n.index).sort().at(-1) ?? null);
    return { root, ops: nodes.map(node => ({ t: 'create', node })) };
}

export const templateStorageKey = 'kerf.templates.v1';
export function readTemplates(storage: Pick<Storage, 'getItem'>): Template[] {
    try {
        const value = JSON.parse(storage.getItem(templateStorageKey) ?? '[]');
        return Array.isArray(value) ? value.filter(validTemplate) : [];
    } catch { return []; }
}
function validTemplate(t: any): t is Template {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || t.category !== 'Yours' || !Number.isFinite(t.w) || t.w <= 0 || !Number.isFinite(t.h) || t.h <= 0 || (t.file !== undefined && typeof t.file !== 'string') || !Array.isArray(t.nodes) || !t.nodes.length || !t.nodes.every(validNode)) return false;
    const ids = new Set(t.nodes.map((n: Node) => n.id));
    return ids.size === t.nodes.length && t.nodes[0].type === 'frame' && t.nodes[0].parent === null && t.nodes.slice(1).every((n: Node, i: number) => n.parent && t.nodes.slice(0, i + 1).some((p: Node) => p.id === n.parent)) && t.nodes.every((n: Node) => !n.instanceOf);
}
export function writeTemplates(storage: Pick<Storage, 'setItem'>, templates: Template[]) { storage.setItem(templateStorageKey, JSON.stringify(templates)); }
