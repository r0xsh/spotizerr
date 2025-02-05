// Import the downloadQueue singleton from your working queue.js implementation.
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
  // Parse artist ID from the URL (expected route: /artist/{id})
  const pathSegments = window.location.pathname.split('/');
  const artistId = pathSegments[pathSegments.indexOf('artist') + 1];

  if (!artistId) {
    showError('No artist ID provided.');
    return;
  }

  // Fetch the artist info (which includes a list of albums)
  fetch(`/api/artist/info?id=${encodeURIComponent(artistId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    })
    .then(data => renderArtist(data))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load artist info.');
    });

  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }
});

/**
 * Renders the artist header and groups the albums by type.
 *
 * The API response is expected to have the following structure:
 * {
 *   "href": "...",
 *   "limit": 50,
 *   "next": null,
 *   "offset": 0,
 *   "previous": null,
 *   "total": 5,
 *   "items": [ { album object }, { album object }, ... ]
 * }
 */
function renderArtist(artistData) {
  // Hide loading and error messages
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Use the first album to extract artist details
  const firstAlbum = artistData.items[0];
  const artistName = firstAlbum?.artists[0]?.name || 'Unknown Artist';
  const artistImage = firstAlbum?.images[0]?.url || 'placeholder.jpg';
  document.getElementById('artist-name').textContent = artistName;
  document.getElementById('artist-stats').textContent = `${artistData.total} albums`;
  document.getElementById('artist-image').src = artistImage;

  // --- Add Back Button ---
  let backButton = document.getElementById('backButton');
  if (!backButton) {
    backButton = document.createElement('button');
    backButton.id = 'backButton';
    backButton.textContent = 'Back';
    backButton.className = 'back-btn';
    // Insert the back button at the beginning of the header container.
    const headerContainer = document.getElementById('artist-header');
    headerContainer.insertBefore(backButton, headerContainer.firstChild);
  }
  backButton.addEventListener('click', () => {
    // Navigate to the site's base URL.
    window.location.href = window.location.origin;
  });

  // --- Add "Download Whole Artist" Button ---
  let downloadArtistBtn = document.getElementById('downloadArtistBtn');
  if (!downloadArtistBtn) {
    downloadArtistBtn = document.createElement('button');
    downloadArtistBtn.id = 'downloadArtistBtn';
    downloadArtistBtn.textContent = 'Download Whole Artist';
    downloadArtistBtn.className = 'download-btn download-btn--main';
    // Insert the button into the header container.
    const headerContainer = document.getElementById('artist-header');
    headerContainer.appendChild(downloadArtistBtn);
  }
  downloadArtistBtn.addEventListener('click', () => {
    // Remove individual album download buttons (but leave the whole artist button).
    document.querySelectorAll('.download-btn').forEach(btn => {
      if (btn.id !== 'downloadArtistBtn') {
        btn.remove();
      }
    });

    // Disable the whole artist button to prevent repeated clicks.
    downloadArtistBtn.disabled = true;
    downloadArtistBtn.textContent = 'Queueing...';

    // Initiate the artist download.
    downloadWholeArtist(artistData).then(() => {
      downloadArtistBtn.textContent = 'Queued!';
    }).catch(err => {
      showError('Failed to queue artist download: ' + err.message);
      downloadArtistBtn.disabled = false;
    });
  });

  // Group albums by album type.
  const albumGroups = {};
  artistData.items.forEach(album => {
    // Normalize album type to lower-case for grouping.
    const type = album.album_type.toLowerCase();
    if (!albumGroups[type]) {
      albumGroups[type] = [];
    }
    albumGroups[type].push(album);
  });

  // Render groups into the #album-groups container.
  const groupsContainer = document.getElementById('album-groups');
  groupsContainer.innerHTML = ''; // clear any previous content

  // For each album type, render a section header, a "Download All" button, and the album list.
  for (const [groupType, albums] of Object.entries(albumGroups)) {
    const groupSection = document.createElement('section');
    groupSection.className = 'album-group';

    // Header for the album group with a download-all button.
    const header = document.createElement('div');
    header.className = 'album-group-header';
    header.innerHTML = `
      <h3>${capitalize(groupType)}s</h3>
      <button class="download-btn download-btn--main group-download-btn" 
              data-album-type="${groupType}" 
              data-artist-url="${firstAlbum.artists[0].external_urls.spotify}">
        Download All ${capitalize(groupType)}s
      </button>
    `;
    groupSection.appendChild(header);

    // Container for the individual albums in this group.
    const albumsContainer = document.createElement('div');
    albumsContainer.className = 'albums-list';
    albums.forEach((album, index) => {
      const albumElement = document.createElement('div');
      albumElement.className = 'track'; // reusing the same CSS classes as in the playlist view
      albumElement.innerHTML = `
        <div class="track-number">${index + 1}</div>
        <img class="track-image" src="${album.images[1]?.url || album.images[0]?.url || 'placeholder.jpg'}" alt="Album cover" style="width: 64px; height: 64px; border-radius: 4px; margin-right: 1rem;">
        <div class="track-info">
          <div class="track-name">${album.name}</div>
          <div class="track-artist">${album.album_type}</div>
        </div>
        <div class="track-album">${album.release_date}</div>
        <div class="track-duration">${album.total_tracks} tracks</div>
        <button class="download-btn download-btn--circle" 
                data-url="${album.external_urls.spotify}" 
                data-type="artist"
                data-album-type="${album.album_type}"
                data-name="${album.name}">
          Download
        </button>
      `;
      albumsContainer.appendChild(albumElement);
    });
    groupSection.appendChild(albumsContainer);
    groupsContainer.appendChild(groupSection);
  }

  // Reveal header and albums container
  document.getElementById('artist-header').classList.remove('hidden');
  document.getElementById('albums-container').classList.remove('hidden');

  // Attach event listeners for individual album download buttons.
  attachDownloadListeners();
  // Attach event listeners for group download buttons.
  attachGroupDownloadListeners();
}

/**
 * Displays an error message in the UI.
 */
function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

/**
 * Attaches event listeners to all individual album download buttons.
 */
function attachDownloadListeners() {
  document.querySelectorAll('.download-btn').forEach((btn) => {
    // Skip group and whole artist download buttons.
    if (btn.id === 'downloadArtistBtn' || btn.classList.contains('group-download-btn')) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url;
      const type = e.currentTarget.dataset.type;
      const name = e.currentTarget.dataset.name || extractName(url);
      const albumType = e.currentTarget.dataset.albumType;
      // Remove the button after click.
      e.currentTarget.remove();
      // Start the download for this album.
      startDownload(url, type, { name }, albumType);
    });
  });
}

/**
 * Attaches event listeners to all group download buttons.
 */
function attachGroupDownloadListeners() {
  document.querySelectorAll('.group-download-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const albumType = e.currentTarget.dataset.albumType;
      const artistUrl = e.currentTarget.dataset.artistUrl;
      // Disable the button to prevent repeated clicks.
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = `Queueing ${capitalize(albumType)}s...`;
      // Initiate a download for this album group.
      startDownload(artistUrl, 'artist', { name: `All ${capitalize(albumType)}s` }, albumType)
        .then(() => {
          e.currentTarget.textContent = `Queued!`;
        })
        .catch(err => {
          showError('Failed to queue group download: ' + err.message);
          e.currentTarget.disabled = false;
        });
    });
  });
}

/**
 * Initiates the whole artist download by calling the artist endpoint.
 */
async function downloadWholeArtist(artistData) {
  // Use the artist external URL from the first album's artist object.
  const artistUrl = artistData.items[0]?.artists[0]?.external_urls.spotify;
  if (!artistUrl) throw new Error('Artist URL not found.');
  // Queue the whole artist download with the descriptive artist name.
  startDownload(artistUrl, 'artist', { name: artistData.items[0]?.artists[0]?.name || 'Artist' });
}

/**
 * Starts the download process by building the API URL,
 * fetching download details, and then adding the download to the queue.
 */
async function startDownload(url, type, item, albumType) {
  // Retrieve configuration (if any) from localStorage.
  const config = JSON.parse(localStorage.getItem('activeConfig')) || {};
  const {
    fallback = false,
    spotify = '',
    deezer = '',
    spotifyQuality = 'NORMAL',
    deezerQuality = 'MP3_128',
    realTime = false
  } = config;

  const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
  let apiUrl = '';

  // Build API URL based on the download type.
  if (type === 'artist') {
    // Use the dedicated artist download endpoint.
    apiUrl = `/api/artist/download?service=${service}&artist_url=${encodeURIComponent(url)}&album_type=${encodeURIComponent(albumType || 'album,single,compilation')}`;
  } else {
    // Default: track or other type.
    apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;
  }

  // Append account and quality details.
  if (fallback && service === 'spotify') {
    apiUrl += `&main=${deezer}&fallback=${spotify}`;
    apiUrl += `&quality=${deezerQuality}&fall_quality=${spotifyQuality}`;
  } else {
    const mainAccount = service === 'spotify' ? spotify : deezer;
    apiUrl += `&main=${mainAccount}&quality=${service === 'spotify' ? spotifyQuality : deezerQuality}`;
  }

  if (realTime) {
    apiUrl += '&real_time=true';
  }

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    // Add the download to the queue using the working queue implementation.
    downloadQueue.addDownload(item, type, data.prg_file);
  } catch (error) {
    showError('Download failed: ' + error.message);
  }
}

/**
 * A helper function to extract a display name from the URL.
 */
function extractName(url) {
  return url;
}

/**
 * Helper to capitalize the first letter of a string.
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
