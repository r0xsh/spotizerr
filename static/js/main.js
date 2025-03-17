// main.js
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchType = document.getElementById('searchType');
    const resultsContainer = document.getElementById('resultsContainer');
    const queueIcon = document.getElementById('queueIcon');
    const emptyState = document.getElementById('emptyState');
    const loadingResults = document.getElementById('loadingResults');

    // Initialize the queue
    if (queueIcon) {
        queueIcon.addEventListener('click', () => {
            downloadQueue.toggleVisibility();
        });
    }

    // Add event listeners
    if (searchButton) {
        searchButton.addEventListener('click', performSearch);
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });

        // Auto-detect and handle pasted Spotify URLs
        searchInput.addEventListener('input', function(e) {
            const inputVal = e.target.value.trim();
            if (isSpotifyUrl(inputVal)) {
                const details = getSpotifyResourceDetails(inputVal);
                if (details) {
                    searchType.value = details.type;
                }
            }
        });
    }

    // Check for URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    const type = urlParams.get('type');

    if (query) {
        searchInput.value = query;
        if (type && ['track', 'album', 'playlist', 'artist'].includes(type)) {
            searchType.value = type;
        }
        performSearch();
    } else {
        // Show empty state if no query
        showEmptyState(true);
    }

    /**
     * Performs the search based on input values
     */
    async function performSearch() {
        const query = searchInput.value.trim();
        if (!query) return;

        // Handle direct Spotify URLs
        if (isSpotifyUrl(query)) {
            const details = getSpotifyResourceDetails(query);
            if (details && details.id) {
                // Redirect to the appropriate page
                window.location.href = `/${details.type}/${details.id}`;
                return;
            }
        }

        // Update URL without reloading page
        const newUrl = `${window.location.pathname}?q=${encodeURIComponent(query)}&type=${searchType.value}`;
        window.history.pushState({ path: newUrl }, '', newUrl);

        // Show loading state
        showEmptyState(false);
        showLoading(true);
        resultsContainer.innerHTML = '';

        try {
            const url = `/api/search?q=${encodeURIComponent(query)}&search_type=${searchType.value}&limit=40`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            
            const data = await response.json();
            
            // Hide loading indicator
            showLoading(false);
            
            // Render results
            if (data && data.items && data.items.length > 0) {
                resultsContainer.innerHTML = '';
                
                data.items.forEach((item, index) => {
                    if (!item) return; // Skip null/undefined items
                    
                    const cardElement = createResultCard(item, searchType.value, index);
                    resultsContainer.appendChild(cardElement);
                });
                
                // Attach download handlers to the newly created cards
                attachDownloadListeners(data.items);
            } else {
                // No results found
                resultsContainer.innerHTML = `
                    <div class="empty-search-results">
                        <p>No results found for "${query}"</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error:', error);
            showLoading(false);
            resultsContainer.innerHTML = `
                <div class="error">
                    <p>Error searching: ${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Attaches download handlers to result cards
     */
    function attachDownloadListeners(items) {
        document.querySelectorAll('.download-btn').forEach((btn, index) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Get the corresponding item
                const item = items[index];
                if (!item) return;
                
                const type = searchType.value;
                let url;
                
                // Determine the URL based on item type
                if (item.external_urls && item.external_urls.spotify) {
                    url = item.external_urls.spotify;
                } else if (item.href) {
                    url = item.href;
                } else {
                    showError('Could not determine download URL');
                    return;
                }
                
                // Prepare metadata for the download
                const metadata = { 
                    name: item.name || 'Unknown',
                    artist: item.artists ? item.artists[0]?.name : undefined
                };
                
                // Disable the button and update text
                btn.disabled = true;
                
                // For artist downloads, show a different message since it will queue multiple albums
                if (type === 'artist') {
                    btn.innerHTML = 'Queueing albums...';
                } else {
                    btn.innerHTML = 'Queueing...';
                }
                
                // Start the download
                startDownload(url, type, metadata, item.album ? item.album.album_type : null)
                    .then(() => {
                        // For artists, show how many albums were queued
                        if (type === 'artist') {
                            btn.innerHTML = 'Albums queued!';
                            // Open the queue automatically for artist downloads
                            downloadQueue.toggleVisibility(true);
                        } else {
                            btn.innerHTML = 'Queued!';
                        }
                    })
                    .catch((error) => {
                        btn.disabled = false;
                        btn.innerHTML = 'Download';
                        showError('Failed to queue download: ' + error.message);
                    });
            });
        });
    }

    /**
     * Starts the download process via API
     */
    async function startDownload(url, type, item, albumType) {
        if (!url || !type) {
            showError('Missing URL or type for download');
            return;
        }
        
        const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
        let apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;

        // Add name and artist if available for better progress display
        if (item.name) {
            apiUrl += `&name=${encodeURIComponent(item.name)}`;
        }
        if (item.artist) {
            apiUrl += `&artist=${encodeURIComponent(item.artist)}`;
        }
        
        // For artist downloads, include album_type
        if (type === 'artist' && albumType) {
            apiUrl += `&album_type=${encodeURIComponent(albumType)}`;
        }

        try {
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Download request failed');
            }
            
            const data = await response.json();
            
            // Handle artist downloads which return multiple album_prg_files
            if (type === 'artist' && data.album_prg_files && Array.isArray(data.album_prg_files)) {
                // Add each album to the download queue separately
                const queueIds = [];
                data.album_prg_files.forEach(prgFile => {
                    const queueId = downloadQueue.addDownload(item, 'album', prgFile, apiUrl, false);
                    queueIds.push({queueId, prgFile});
                });
                
                // Wait a short time before checking the status to give server time to create files
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Start monitoring each entry after confirming PRG files exist
                for (const {queueId, prgFile} of queueIds) {
                    try {
                        const statusResponse = await fetch(`/api/prgs/${prgFile}`);
                        if (statusResponse.ok) {
                            // Only start monitoring after confirming the PRG file exists
                            const entry = downloadQueue.downloadQueue[queueId];
                            if (entry) {
                                // Start monitoring regardless of visibility
                                downloadQueue.startEntryMonitoring(queueId);
                            }
                        }
                    } catch (statusError) {
                        console.log(`Initial status check pending for ${prgFile}, will retry on next interval`);
                    }
                }
                
                // Show success message for artist download
                if (data.message) {
                    showSuccess(data.message);
                }
            } else if (data.prg_file) {
                // Handle single-file downloads (tracks, albums, playlists)
                const queueId = downloadQueue.addDownload(item, type, data.prg_file, apiUrl, false);
                
                // Wait a short time before checking the status to give server time to create the file
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Ensure the PRG file exists and has initial data by making a status check
                try {
                    const statusResponse = await fetch(`/api/prgs/${data.prg_file}`);
                    if (statusResponse.ok) {
                        // Only start monitoring after confirming the PRG file exists
                        const entry = downloadQueue.downloadQueue[queueId];
                        if (entry) {
                            // Start monitoring regardless of visibility
                            downloadQueue.startEntryMonitoring(queueId);
                        }
                    }
                } catch (statusError) {
                    console.log('Initial status check pending, will retry on next interval');
                }
            } else {
                throw new Error('Invalid response format from server');
            }
        } catch (error) {
            showError('Download failed: ' + (error.message || 'Unknown error'));
            throw error;
        }
    }

    /**
     * Shows an error message
     */
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        
        // Auto-remove after 5 seconds
        setTimeout(() => errorDiv.remove(), 5000);
    }
    
    /**
     * Shows a success message
     */
    function showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success';
        successDiv.textContent = message;
        document.body.appendChild(successDiv);
        
        // Auto-remove after 5 seconds
        setTimeout(() => successDiv.remove(), 5000);
    }

    /**
     * Checks if a string is a valid Spotify URL
     */
    function isSpotifyUrl(url) {
        return url.includes('open.spotify.com') || 
               url.includes('spotify:') ||
               url.includes('link.tospotify.com');
    }

    /**
     * Extracts details from a Spotify URL
     */
    function getSpotifyResourceDetails(url) {
        const regex = /spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/;
        const match = url.match(regex);
        
        if (match) {
            return {
                type: match[1],
                id: match[2]
            };
        }
        return null;
    }

    /**
     * Formats milliseconds to MM:SS
     */
    function msToMinutesSeconds(ms) {
        if (!ms) return '0:00';
        
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}:${seconds.padStart(2, '0')}`;
    }

    /**
     * Creates a result card element
     */
    function createResultCard(item, type, index) {
        const cardElement = document.createElement('div');
        cardElement.className = 'result-card';
        
        // Set cursor to pointer for clickable cards
        cardElement.style.cursor = 'pointer';
        
        // Get the appropriate image URL
        let imageUrl = '/static/images/placeholder.jpg';
        if (item.album && item.album.images && item.album.images.length > 0) {
            imageUrl = item.album.images[0].url;
        } else if (item.images && item.images.length > 0) {
            imageUrl = item.images[0].url;
        }
        
        // Get the appropriate details based on type
        let subtitle = '';
        let details = '';
        
        switch (type) {
            case 'track':
                subtitle = item.artists ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist';
                details = item.album ? `<span>${item.album.name}</span><span class="duration">${msToMinutesSeconds(item.duration_ms)}</span>` : '';
                break;
            case 'album':
                subtitle = item.artists ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist';
                details = `<span>${item.total_tracks || 0} tracks</span><span>${item.release_date ? new Date(item.release_date).getFullYear() : ''}</span>`;
                break;
            case 'playlist':
                subtitle = `By ${item.owner ? item.owner.display_name : 'Unknown'}`;
                details = `<span>${item.tracks && item.tracks.total ? item.tracks.total : 0} tracks</span>`;
                break;
            case 'artist':
                subtitle = 'Artist';
                details = item.genres ? `<span>${item.genres.slice(0, 2).join(', ')}</span>` : '';
                break;
        }
        
        // Build the HTML
        cardElement.innerHTML = `
            <div class="album-art-wrapper">
                <img class="album-art" src="${imageUrl}" alt="${item.name || 'Item'}" onerror="this.src='/static/images/placeholder.jpg'">
            </div>
            <div class="track-title">${item.name || 'Unknown'}</div>
            <div class="track-artist">${subtitle}</div>
            <div class="track-details">${details}</div>
            <button class="download-btn btn-primary">
                <img src="/static/images/download.svg" alt="Download" /> 
                Download
            </button>
        `;
        
        // Add click event to navigate to the item's detail page
        cardElement.addEventListener('click', (e) => {
            // Don't trigger if the download button was clicked
            if (e.target.classList.contains('download-btn') || 
                e.target.parentElement.classList.contains('download-btn')) {
                return;
            }
            
            if (item.id) {
                window.location.href = `/${type}/${item.id}`;
            }
        });
        
        return cardElement;
    }

    /**
     * Show/hide the empty state
     */
    function showEmptyState(show) {
        if (emptyState) {
            emptyState.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Show/hide the loading indicator
     */
    function showLoading(show) {
        if (loadingResults) {
            loadingResults.classList.toggle('hidden', !show);
        }
    }
});
