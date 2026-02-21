using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Sockets;

namespace GBEServerManager;

public class ServerManagerContext : ApplicationContext
{
    private readonly NotifyIcon _trayIcon;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly ToolStripMenuItem _statusItem;
    private readonly System.Windows.Forms.Timer _pollTimer;
    private Process? _serverProcess;
    private bool _isRunning;

    private const int ServerPort = 3000;
    private const string DashboardUrl = "http://localhost:3000";

    // Derive server path relative to this exe: tools/GBEServerManager/bin/... -> server/
    private static string GetServerPath()
    {
        // Walk up from exe location to find the server folder
        var exeDir = AppContext.BaseDirectory;
        var dir = new DirectoryInfo(exeDir);

        // Try to find server/src/index.js by walking up
        for (int i = 0; i < 6; i++)
        {
            if (dir?.Parent == null) break;
            dir = dir.Parent;
            var candidate = Path.Combine(dir.FullName, "server", "src", "index.js");
            if (File.Exists(candidate))
                return Path.Combine(dir.FullName, "server");
        }

        // Fallback: hardcoded path
        return @"D:\GoldBottomEntLLC\server";
    }

    public ServerManagerContext()
    {
        // Build context menu
        _statusItem = new ToolStripMenuItem("Status: Checking...")
        {
            Enabled = false,
            Font = new Font("Segoe UI", 9, FontStyle.Bold)
        };

        _startItem = new ToolStripMenuItem("Start Server", null, OnStart);
        _stopItem = new ToolStripMenuItem("Stop Server", null, OnStop);

        var dashboardItem = new ToolStripMenuItem("Open Dashboard", null, OnOpenDashboard);
        var exitItem = new ToolStripMenuItem("Exit", null, OnExit);

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(dashboardItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exitItem);

        // Create tray icon
        _trayIcon = new NotifyIcon
        {
            Text = "GBE Server Manager",
            ContextMenuStrip = menu,
            Visible = true
        };

        _trayIcon.DoubleClick += OnOpenDashboard;

        // Poll server status every 3 seconds
        _pollTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        _pollTimer.Tick += (_, _) => UpdateStatus();
        _pollTimer.Start();

        // Initial status check
        UpdateStatus();
    }

    private void UpdateStatus()
    {
        _isRunning = IsPortInUse(ServerPort);

        if (_isRunning)
        {
            _trayIcon.Icon = CreateIcon(Color.FromArgb(63, 185, 80)); // Green
            _trayIcon.Text = "GBE Server - Running (port 3000)";
            _statusItem.Text = "Status: Running";
            _statusItem.ForeColor = Color.Green;
            _startItem.Enabled = false;
            _stopItem.Enabled = true;
        }
        else
        {
            _trayIcon.Icon = CreateIcon(Color.FromArgb(248, 81, 73)); // Red
            _trayIcon.Text = "GBE Server - Stopped";
            _statusItem.Text = "Status: Stopped";
            _statusItem.ForeColor = Color.Red;
            _startItem.Enabled = true;
            _stopItem.Enabled = false;
        }
    }

    private void OnStart(object? sender, EventArgs e)
    {
        try
        {
            var serverPath = GetServerPath();
            var indexJs = Path.Combine(serverPath, "src", "index.js");

            if (!File.Exists(indexJs))
            {
                MessageBox.Show($"Server entry point not found:\n{indexJs}",
                    "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Find node.exe
            var nodePath = FindNode();
            if (nodePath == null)
            {
                MessageBox.Show("node.exe not found. Make sure Node.js is installed and in your PATH.",
                    "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            _serverProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "src/index.js",
                    WorkingDirectory = serverPath,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false,
                },
                EnableRaisingEvents = true
            };

            _serverProcess.Exited += (_, _) =>
            {
                _serverProcess = null;
                UpdateStatus();
            };

            _serverProcess.Start();

            // Brief delay then update
            Task.Delay(1500).ContinueWith(_ =>
            {
                if (_trayIcon != null)
                    _trayIcon.GetType().InvokeMember("", System.Reflection.BindingFlags.Default, null, null, null);
                UpdateStatus();
            }, TaskScheduler.FromCurrentSynchronizationContext());

            _trayIcon.ShowBalloonTip(2000, "GBE Server", "Server starting on port 3000...", ToolTipIcon.Info);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to start server:\n{ex.Message}",
                "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OnStop(object? sender, EventArgs e)
    {
        try
        {
            // Kill our tracked process if we have one
            if (_serverProcess != null && !_serverProcess.HasExited)
            {
                _serverProcess.Kill(true);
                _serverProcess = null;
            }
            else
            {
                // Find and kill any node process on port 3000
                KillProcessOnPort(ServerPort);
            }

            _trayIcon.ShowBalloonTip(2000, "GBE Server", "Server stopped.", ToolTipIcon.Info);

            Task.Delay(1000).ContinueWith(_ => UpdateStatus(), TaskScheduler.FromCurrentSynchronizationContext());
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to stop server:\n{ex.Message}",
                "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OnOpenDashboard(object? sender, EventArgs e)
    {
        if (_isRunning)
        {
            Process.Start(new ProcessStartInfo(DashboardUrl) { UseShellExecute = true });
        }
        else
        {
            MessageBox.Show("Server is not running. Start it first.",
                "Server Offline", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void OnExit(object? sender, EventArgs e)
    {
        // Stop server if we started it
        if (_serverProcess != null && !_serverProcess.HasExited)
        {
            var result = MessageBox.Show("Stop the server before exiting?",
                "GBE Server Manager", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);

            if (result == DialogResult.Cancel) return;
            if (result == DialogResult.Yes)
            {
                _serverProcess.Kill(true);
                _serverProcess = null;
            }
        }

        _pollTimer.Stop();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        Application.Exit();
    }

    // ── Helpers ──────────────────────────────────────────

    private static bool IsPortInUse(int port)
    {
        try
        {
            using var client = new TcpClient();
            var result = client.BeginConnect(IPAddress.Loopback, port, null, null);
            var success = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(500));
            if (success)
            {
                client.EndConnect(result);
                return true;
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    private static string? FindNode()
    {
        // Check common locations
        var paths = new[]
        {
            "node.exe", // PATH
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
        };

        foreach (var p in paths)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = p,
                    Arguments = "--version",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    proc.WaitForExit(3000);
                    if (proc.ExitCode == 0) return p;
                }
            }
            catch { }
        }

        return null;
    }

    private static void KillProcessOnPort(int port)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"for /f \"tokens=5\" %a in ('netstat -ano ^| findstr 0.0.0.0:{port} ^| findstr LISTENING') do taskkill /PID %a /F\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(5000);
        }
        catch { }
    }

    private static Icon CreateIcon(Color color)
    {
        var bmp = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            // Diamond/gem shape
            using var brush = new SolidBrush(color);
            var points = new Point[]
            {
                new(8, 1),   // top
                new(14, 6),  // right
                new(8, 14),  // bottom
                new(2, 6),   // left
            };
            g.FillPolygon(brush, points);

            // Highlight facet
            using var lightBrush = new SolidBrush(Color.FromArgb(80, 255, 255, 255));
            var highlight = new Point[]
            {
                new(8, 1),
                new(14, 6),
                new(8, 6),
            };
            g.FillPolygon(lightBrush, highlight);
        }

        var icon = Icon.FromHandle(bmp.GetHicon());
        return icon;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pollTimer?.Dispose();
            _trayIcon?.Dispose();
        }
        base.Dispose(disposing);
    }
}
