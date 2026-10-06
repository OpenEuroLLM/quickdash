"""The pre-PR command must propagate browser failures and clean up Chrome."""
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch
from tests import check


class CheckCommand(unittest.TestCase):
    def test_browser_uses_own_port_and_cleans_up_on_success_or_failure(self):
        for fails in (False, True):
            with self.subTest(fails=fails):
                browser = Mock()
                directories = []

                def launch(args, **kwargs):
                    profile = Path(next(a.split('=', 1)[1] for a in args if a.startswith('--user-data-dir=')))
                    profile.mkdir()
                    (profile / 'DevToolsActivePort').write_text('43210\n/devtools/browser/test\n')
                    directories.append(profile.parent)
                    return browser

                failure = subprocess.CalledProcessError(1, 'node') if fails else None
                with patch.object(check.subprocess, 'Popen', side_effect=launch), patch.object(check.subprocess, 'run', side_effect=failure) as run:
                    if fails:
                        with self.assertRaises(subprocess.CalledProcessError):
                            check.run_browser('chrome')
                    else:
                        check.run_browser('chrome')
                    self.assertEqual(run.call_args.kwargs['env']['QUICKDASH_CHROME_PORT'], '43210')
                    self.assertTrue(run.call_args.kwargs['check'])
                browser.terminate.assert_called_once()
                browser.wait.assert_called_once_with(timeout=10)
                self.assertFalse(directories[0].exists())

    def test_missing_browser_is_an_error_not_a_skipped_check(self):
        with patch.object(check.os.path, 'isfile', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Chrome is required'):
                check.find_chrome()
