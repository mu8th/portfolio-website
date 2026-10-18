// Search page for the sample shop (intentionally flawed).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function showResults(list, query, items) {
  list.innerHTML = '';
  list.innerHTML = '<li>Results for ' + query + '</li>';
  items.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${esc(item.name)}</td><td>${esc(item.price)}</td>`;
    list.appendChild(row);
  });
}

function greet(banner, user) {
  banner.innerHTML = `Welcome back, ${user.name}`;
}

function runCommand() {
  eval(location.hash.slice(1));
}

function emptyState(list) {
  list.innerHTML = '<p class="empty">No results</p>';
}
