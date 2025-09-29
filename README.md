

# Space Invader game using WebGPU

This app is mostly generated and created using Google AI Studio. 
Features are added incrementally; the initial iteration was simply a 2D space invader game. 
This was then iterated multiple times to add in WebGPU, and then to continue to utilise WebGPU features.


## Run Locally

**Prerequisites:**  npm

1. Clone the repo:
   `git clone https://github.com/powhwee/spaceinvader.git`
2. Change directory into where the repo is checked out.
   `cd spaceinvader`
3. Install dependencies:
   `npm install`
4. Run the app:
   `npm run dev`

**Note:**  After you type 'npm run dev' it will give you a list of URLs that can be used to access the game.  Note that the URL is HTTPS not HTTP.  WebGPU requires transport to be TLS encrypted -- this is enforced by the browser.  If you disable SSL, you will only be able to run http://localhost only, and not accessible from a browser running on a different machine.  

