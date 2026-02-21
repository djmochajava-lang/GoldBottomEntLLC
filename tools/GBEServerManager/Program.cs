namespace GBEServerManager;

static class Program
{
    [STAThread]
    static void Main()
    {
        // Prevent multiple instances
        using var mutex = new Mutex(true, "GBEServerManager_SingleInstance", out bool isNew);
        if (!isNew)
        {
            MessageBox.Show("GBE Server Manager is already running.\nCheck your system tray.",
                "Already Running", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new ServerManagerContext());
    }
}
