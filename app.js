const $ = id => document.getElementById(id);
let token = location.hash.slice(1);
let loading = false;
let sending = false;
let rendered = '';
let olderMessages = [];
let latestMessages = [];
let hasOlder = false;

function notice(text) {
    $('notice').textContent = text || '';
}

function apiUrl() {
    if (!window.TICKET_API_URL) throw new Error('Die Website-API ist noch nicht eingerichtet. Bitte kontaktiere den Betreiber.');
    const url = new URL(window.TICKET_API_URL);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Die Website-API ist noch nicht sicher eingerichtet.');
    }
    return url.origin;
}

async function request(path, options = {}) {
    const headers = { ...options.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${apiUrl()}${path}`, { ...options, headers, cache: 'no-store', referrerPolicy: 'no-referrer' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Die Anfrage ist fehlgeschlagen.');
    return data;
}

function updatePrice() {
    const isMap = $('type').value === 'mapart';
    $('dimensions').hidden = !isMap;
    const height = Number($('height').value);
    const width = Number($('width').value);
    $('price').textContent = isMap && height > 0 && width > 0
        ? `Grundpreis: ${(height * width * 250000).toLocaleString('de-DE')} (${height * width} Kartenteile). Ein gültiger Rabatt wird im Ticket berücksichtigt.`
        : '';
}

function renderMessages(messages) {
    const signature = JSON.stringify(messages);
    if (rendered === signature) return;
    rendered = signature;
    const container = $('messages');
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    container.replaceChildren();
    for (const message of messages) {
        const card = document.createElement('article');
        card.className = 'message';
        const title = document.createElement('strong');
        title.textContent = message.author;
        const date = document.createElement('small');
        date.textContent = ` · ${new Date(message.time).toLocaleString('de-DE')}`;
        card.append(title, date);
        const addText = (tag, text) => {
            if (!text) return;
            const element = document.createElement(tag);
            element.textContent = text;
            card.append(element);
        };
        addText('p', message.content);
        for (const embed of message.embeds) {
            addText('h3', embed.title);
            addText('p', embed.description);
            for (const field of embed.fields) addText('p', `${field.name}: ${field.value}`);
        }
        for (const attachment of message.attachments) {
            const link = document.createElement('a');
            link.href = attachment.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = attachment.name || 'Anhang öffnen';
            card.append(link);
            if (attachment.image) {
                const image = document.createElement('img');
                image.src = attachment.url;
                image.alt = attachment.name || 'Bild im Ticket';
                image.loading = 'lazy';
                image.referrerPolicy = 'no-referrer';
                card.append(image);
            }
        }
        container.append(card);
    }
    if (nearBottom) container.scrollTop = container.scrollHeight;
}

async function refresh() {
    if (!token || loading) return;
    loading = true;
    try {
        const ticket = await request('/api/ticket');
        $('create').hidden = true;
        $('ticket').hidden = false;
        $('ticket-name').textContent = ticket.name;
        $('ticket-status').textContent = ticket.closed ? 'Geschlossen' : 'Offen';
        $('message-form').hidden = ticket.closed;
        $('image-hint').textContent = ticket.type === 'mapart'
            ? 'Für die Karte kann genau ein Bild hochgeladen werden. Das Team kann es bei Bedarf zurücksetzen.'
            : 'Du kannst Bilder mit deinem Auftrag senden.';
        const newFirst = ticket.messages[0];
        if (newFirst) {
            const displaced = latestMessages.filter(message => BigInt(message.id) < BigInt(newFirst.id));
            const retained = new Map([...olderMessages, ...displaced].map(message => [message.id, message]));
            olderMessages = [...retained.values()];
        }
        latestMessages = ticket.messages;
        const latestIds = new Set(latestMessages.map(message => message.id));
        olderMessages = olderMessages.filter(message => !latestIds.has(message.id));
        if (!olderMessages.length) hasOlder = latestMessages.length === 100;
        $('older').hidden = !hasOlder;
        renderMessages([...olderMessages, ...latestMessages]);
    } catch (error) {
        notice(error.message);
    } finally {
        loading = false;
    }
}

$('older').addEventListener('click', async () => {
    const first = olderMessages[0] || latestMessages[0];
    if (!first) return;
    $('older').disabled = true;
    try {
        const ticket = await request(`/api/ticket?before=${encodeURIComponent(first.id)}`);
        olderMessages = [...ticket.messages, ...olderMessages];
        hasOlder = ticket.messages.length === 100;
        $('older').hidden = !hasOlder;
        renderMessages([...olderMessages, ...latestMessages]);
    } catch (error) {
        notice(error.message);
    } finally {
        $('older').disabled = false;
    }
});

$('type').addEventListener('change', updatePrice);
$('height').addEventListener('input', updatePrice);
$('width').addEventListener('input', updatePrice);
$('create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    notice('');
    try {
        const result = await request('/api/tickets', {
            method: 'POST',
            body: JSON.stringify({
                type: $('type').value, name: $('name').value, description: $('description').value,
                height: Number($('height').value), width: Number($('width').value),
                discount: $('discount').value.trim(),
            }),
        });
        token = result.token;
        location.hash = token;
        await refresh();
        if (result.warning) notice(result.warning);
    } catch (error) {
        notice(error.message);
    } finally {
        button.disabled = false;
    }
});

function readImage(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        if (file.size > 7 * 1024 * 1024) return reject(new Error('Das Bild darf höchstens 7 MB groß sein.'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
        reader.onload = () => resolve({ name: file.name, data: reader.result.split(',')[1] });
        reader.readAsDataURL(file);
    });
}

$('message-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    event.submitter.disabled = true;
    notice('');
    try {
        const image = await readImage($('image').files[0]);
        await request('/api/ticket/messages', {
            method: 'POST', body: JSON.stringify({ content: $('content').value, image }),
        });
        $('content').value = '';
        $('image').value = '';
        await refresh();
    } catch (error) {
        notice(error.message);
    } finally {
        sending = false;
        event.submitter.disabled = false;
    }
});

$('copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(location.href);
        notice('Ticket-Link kopiert. Bitte sicher aufbewahren.');
    } catch {
        notice('Link konnte nicht automatisch kopiert werden. Bitte kopiere ihn aus der Adresszeile.');
    }
});

window.addEventListener('hashchange', () => {
    token = location.hash.slice(1);
    rendered = '';
    olderMessages = [];
    latestMessages = [];
    hasOlder = false;
    if (token) refresh();
    else {
        $('ticket').hidden = true;
        $('create').hidden = false;
    }
});
updatePrice();
if (!window.TICKET_API_URL) {
    notice('Die Website ist erreichbar, aber die Verbindung zum Ticket-Bot wird noch eingerichtet. Aufträge können derzeit noch nicht erstellt werden.');
    $('create-form').querySelector('button').disabled = true;
}
if (token) refresh();
setInterval(refresh, 5000);
