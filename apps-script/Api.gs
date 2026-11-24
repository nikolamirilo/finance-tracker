/**
 * Phone app API (used by the Finance PWA).
 *
 * The PWA sends POST requests with a JSON body: { key, action, ... }.
 *   action "data"   -> categories + all transactions
 *   action "add"    -> adds one transaction (same rules as the sidebar), returns fresh data
 *   action "delete" -> deletes one transaction row, returns fresh data
 *
 * Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".
 * Every request must carry the secret key from Finance > Connect phone app.
 * Without the key the web app returns nothing but an error.
 */

var API_KEY_PROP = 'FT_API_KEY';
var API_URL_PROP = 'FT_API_URL';
var APP_URL_PROP = 'FT_APP_URL';

function doGet() {
  return json_({ ok: true, app: 'finance-tracker-api', hint: 'The phone app talks to this URL with POST requests.' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  try {
    checkKey_(req.key);
    if (req.action === 'data') return json_(apiData_(false));
    if (req.action === 'add') return json_(apiAdd_(req));
    if (req.action === 'delete') return json_(apiDelete_(req));
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err), auth: !!(err && err.auth) });
  }
}

/* ------------------------------------------------------------------ actions */

/** skipRecurring: true right after an add or delete (the open already posted due items). */
function apiData_(skipRecurring) {
  if (!skipRecurring) { try { postRecurring_(); } catch (e) {} }
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();

  var catSh = ss.getSheetByName(SH.CAT);
  var cl = lastRowInCol_(catSh, 1);
  var cats = cl < 2 ? [] : catSh.getRange(2, 1, cl - 1, 6).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { n: String(r[0]), a: String(r[1]), t: String(r[2]), g: String(r[3] || ''), b: Number(r[4]) || 0, c: String(r[5] || '') };
    });

  var txSh = ss.getSheetByName(SH.TX);
  var tl = lastRowInCol_(txSh, 1);
  var tx = [];
  if (tl >= 2) {
    txSh.getRange(2, 1, tl - 1, 7).getValues().forEach(function (r) {
      var d = toDate_(r[0]);
      if (!d) return;
      tx.push([Utilities.formatDate(d, tz, 'yyyy-MM-dd'), String(r[1]), String(r[2]), String(r[3]),
        String(r[4] || ''), Number(r[5]) || 0, addedMs_(r[6])]);
    });
  }

  return {
    ok: true,
    tz: tz,
    today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
    sheetUrl: ss.getUrl(),
    types: TYPES,
    accounts: ACCOUNTS,
    categories: cats,
    tx: tx,
    at: Date.now()
  };
}

function apiAdd_(req) {
  var t = req.tx || {};
  var cache = CacheService.getScriptCache();
  var cid = req.clientId ? 'ftcid_' + String(req.clientId).replace(/[^\w-]/g, '').slice(0, 80) : '';
  if (cid && cache.get(cid)) {
    var dup = apiData_(true);
    dup.duplicate = true;
    return dup;
  }

  var amount = Math.round(Number(t.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Enter an amount above zero.');
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || '')) ? String(t.date) : '';
  var known = apiCategoryNames_();
  if (known.indexOf(String(t.category)) < 0) throw new Error('Unknown category "' + t.category + '". Refresh the app.');

  var before = Date.now();
  // addTransaction() strips dots as thousand separators and reads a comma as the decimal mark.
  addTransaction({
    date: date,
    account: t.account,
    type: t.type,
    category: String(t.category),
    description: String(t.description || '').slice(0, 200),
    amount: String(amount).replace('.', ','),
    repeat: !!t.repeat
  });
  if (cid) cache.put(cid, '1', 21600);

  var data = apiData_(true);
  // Find the row we just wrote, so the app can offer Undo.
  for (var i = 0; i < data.tx.length; i++) {
    var r = data.tx[i];
    if (r[6] >= before - 2000 && r[1] === t.account && r[2] === t.type && r[3] === String(t.category) && Math.abs(r[5] - amount) < 0.005) {
      data.added = r;
      break;
    }
  }
  return data;
}

function apiDelete_(req) {
  var m = req.tx;
  if (!m || m.length < 7) throw new Error('Nothing to delete.');
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var sh = ss.getSheetByName(SH.TX);
  var found = false;
  var lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    var last = lastRowInCol_(sh, 1);
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, 7).getValues();
      for (var i = 0; i < vals.length; i++) {
        var r = vals[i];
        var d = toDate_(r[0]);
        if (!d) continue;
        if (Utilities.formatDate(d, tz, 'yyyy-MM-dd') === m[0] &&
            String(r[1]) === m[1] && String(r[2]) === m[2] && String(r[3]) === m[3] &&
            String(r[4] || '') === m[4] &&
            Math.abs((Number(r[5]) || 0) - Number(m[5])) < 0.005 &&
            Math.abs(addedMs_(r[6]) - Number(m[6] || 0)) < 1000) {
          sh.deleteRow(i + 2);
          found = true;
          break;
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
  if (!found) throw new Error('That transaction was changed in the sheet. Refresh and try again.');
  return apiData_(true);
}

/* ------------------------------------------------------------------ connect dialog */

function showConnectPhone() {
  var html = HtmlService.createHtmlOutputFromFile('ConnectPhone').setWidth(480).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Connect phone app');
}

function getConnectInfo() {
  var p = PropertiesService.getScriptProperties();
  var key = p.getProperty(API_KEY_PROP);
  if (!key) {
    key = newApiKey_();
    p.setProperty(API_KEY_PROP, key);
  }
  return {
    key: key,
    apiUrl: p.getProperty(API_URL_PROP) || guessApiUrl_(),
    appUrl: p.getProperty(APP_URL_PROP) || ''
  };
}

function saveConnectInfo(o) {
  var p = PropertiesService.getScriptProperties();
  var api = String((o && o.apiUrl) || '').trim();
  var app = String((o && o.appUrl) || '').trim().replace(/[#?].*$/, '');
  if (api && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(api)) {
    throw new Error('The web app URL should start with https://script.google.com/ and end with /exec.');
  }
  if (app && !/^https:\/\//.test(app)) throw new Error('The app address should start with https://');
  p.setProperty(API_URL_PROP, api);
  p.setProperty(APP_URL_PROP, app);
  return getConnectInfo();
}

/** Makes a new key. Phones connected with the old key have to be connected again. */
function rotateApiKey() {
  PropertiesService.getScriptProperties().setProperty(API_KEY_PROP, newApiKey_());
  return getConnectInfo();
}

/* ------------------------------------------------------------------ helpers */

function checkKey_(key) {
  var saved = PropertiesService.getScriptProperties().getProperty(API_KEY_PROP);
  if (!saved || !key || String(key) !== saved) {
    var e = new Error('This phone is not connected. In the sheet, open Finance > Connect phone app and scan the code again.');
    e.auth = true;
    throw e;
  }
}

function apiCategoryNames_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CAT);
  var last = lastRowInCol_(sh, 1);
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }).filter(String);
}

function newApiKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function guessApiUrl_() {
  try {
    var u = ScriptApp.getService().getUrl();
    return u && /\/exec$/.test(u) ? u : '';
  } catch (e) {
    return '';
  }
}

/** Accepts a Date, "dd.mm.yyyy" or "mm/dd/yyyy". */
function toDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return null;
}

function addedMs_(v) {
  var d = toDate_(v);
  return d ? d.getTime() : 0;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
