// Simple front-end interactions. No backend calls yet.

document.addEventListener('DOMContentLoaded', function () {

  // Mark active nav link based on current page
  var here = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    if (a.getAttribute('href') === here) a.classList.add('active');
  });

  // Hero "live" sensor readout — small illustrative animation, not real data
  var moisture = document.getElementById('readout-moisture');
  var eta = document.getElementById('readout-eta');
  if (moisture) {
    var base = 24.4;
    setInterval(function () {
      base += (Math.random() - 0.55) * 0.3;
      moisture.textContent = base.toFixed(1) + ' %';
    }, 2200);
  }

  // Contact form: sends the "request a demo" submission to the backend API.
  // Empty string = same-origin relative path (/api/contact) — this is what
  // you want on Vercel, since the API and the site are served together.
  var API_BASE = '';

  var form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('form-status');
      var submitBtn = form.querySelector('button[type="submit"]');

      var payload = {
        name: document.getElementById('name').value,
        phone: document.getElementById('phone').value,
        village: document.getElementById('village').value,
        role: document.getElementById('role').value,
        message: document.getElementById('message').value
      };

      status.style.display = 'block';
      status.style.color = '';
      status.textContent = 'Sending your request...';
      if (submitBtn) submitBtn.disabled = true;

      fetch(API_BASE + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            status.textContent = result.data.message;
            form.reset();
          } else {
            status.style.color = '#B3261E';
            status.textContent = result.data.error || 'Something went wrong. Please try again.';
          }
        })
        .catch(function () {
          status.style.color = '#B3261E';
          status.textContent = 'Could not reach the server. If you are testing locally, make sure "vercel dev" is running.';
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

});
