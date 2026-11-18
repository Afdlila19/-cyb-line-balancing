CYB LINE BALANCING - LOCAL NETWORK VERSION
===========================================

Want it online instead (a web address that works from anywhere)?
See DEPLOY-ONLINE.txt. The same folder does both.

One PC on the factory network runs the server. Everyone else opens the page in
a web browser (Chrome or Edge, on a PC or tablet). No internet is needed.

What's in this folder
  start-windows.bat     double-click to start the server on Windows
  start-linux-mac.sh    the same for Linux / Mac
  server.py             the server (Python 3, no extra packages)
  public\               the web page and the line data (line.json)
  data\                 created on first run: shared data + daily backups


1. SET UP THE SERVER PC (once)
------------------------------
  a. Pick a PC that stays on during production (an office PC or a small server).
  b. Install Python 3.8 or newer from the official python.org installer.
     On the first installer screen, tick "Add python.exe to PATH".
  c. Copy this whole folder to the PC, for example  C:\CYB-Balancing
  d. Double-click start-windows.bat. A black window opens and shows lines like:

        On this PC:        http://localhost:8080
        On the network:    http://192.168.1.25:8080

     Keep that window open. Closing it stops the system.
  e. If Windows Firewall asks, click "Allow access" for Private networks.
     (If it did not ask and other PCs cannot connect, allow TCP port 8080
      inbound in Windows Defender Firewall > Advanced settings > Inbound rules.)
  f. Ask IT to give this PC a fixed IP address (DHCP reservation), so the
     address does not change.


2. OPEN IT FROM ANY PC ON THE NETWORK
-------------------------------------
  Type the "On the network" address in the browser, e.g.  http://192.168.1.25:8080
  Process search directly:                                http://192.168.1.25:8080/#lookup

  Tip: bookmark it, or print the #lookup address as a QR code at each machine.
  Each person can click "Set your name" (bottom right) so their time studies and
  scenarios show who entered them.


3. PROTECT SAVING WITH A PIN (optional)
---------------------------------------
  By default anyone on the network can save scenarios, time studies and settings.
  To allow viewing for everyone but saving only with a PIN:
    open start-windows.bat in Notepad, change   set CYB_PIN=   to   set CYB_PIN=4321
    save, and restart the server.
  People who need to save click "Enter edit PIN" (bottom right) once per browser.


4. START AUTOMATICALLY WHEN THE PC STARTS (optional)
---------------------------------------------------
  Press Win+R, type  shell:startup , press Enter, and put a shortcut to
  start-windows.bat in that folder. (Or use Task Scheduler "At log on".)


5. BACKUP AND RESTORE
---------------------
  All shared data is in   data\cyb_data.json
  A copy is kept each day in  data\backups\  (last 30 days).
  To restore: stop the server, copy a backup over data\cyb_data.json, start again.
  To move to another PC: copy the whole folder, including data\.


6. UPDATING THE LINE DATA
-------------------------
  The stations, machines, cycle times and features come from public\line.json,
  taken from the CYB Line Process Viewer. When the process changes, replace
  public\line.json with a new export and refresh the browsers. Saved scenarios
  and time studies are kept. Cycle times can also be overridden on the
  "Takt & time model" tab without changing the file.


TROUBLESHOOTING
  Red bar "Cannot reach the CYB server"  -> the server window was closed or the
                                            PC is off / asleep. Start it again.
  Other PCs cannot open the page         -> check the firewall (step 1e) and that
                                            both PCs are on the same network.
  "Python 3 is not installed"            -> repeat step 1b, tick "Add to PATH".
  Port 8080 already in use               -> change  set CYB_PORT=8080  to e.g. 8090.
