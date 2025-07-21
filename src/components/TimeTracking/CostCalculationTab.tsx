import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Calculator, TrendingUp, TrendingDown, FileDown, DollarSign } from "lucide-react";

const CostCalculationTab = () => {
  const [hourlyRate, setHourlyRate] = useState(1500);
  const [projectBudget, setProjectBudget] = useState(600000);
  
  // Mock data - in real app, this would come from the time entry tab and BOM
  const totalHours = 135;
  const bomCost = 450000;
  const totalEngineerCost = totalHours * hourlyRate;
  const totalProjectCost = bomCost + totalEngineerCost;
  const profitOrLoss = projectBudget - totalProjectCost;
  const isProfit = profitOrLoss > 0;
  const budgetUtilization = (totalProjectCost / projectBudget) * 100;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Cost Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Cost Parameters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Hourly Rate (₹)</label>
              <Input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(parseInt(e.target.value) || 0)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Project Budget (₹)</label>
              <Input
                type="number"
                value={projectBudget}
                onChange={(e) => setProjectBudget(parseInt(e.target.value) || 0)}
                className="mt-2"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Total Cost Calculation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm font-medium">BOM Cost</span>
                  <span className="font-semibold">{formatCurrency(bomCost)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm font-medium">Total Hours</span>
                  <span className="font-semibold">{totalHours} hours</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm font-medium">Engineer Cost ({totalHours}h × ₹{hourlyRate})</span>
                  <span className="font-semibold">{formatCurrency(totalEngineerCost)}</span>
                </div>
              </div>
              <div className="bg-muted p-4 rounded-lg">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Total Project Cost</p>
                  <p className="text-3xl font-bold text-primary">{formatCurrency(totalProjectCost)}</p>
                </div>
              </div>
            </div>
            
            <div className="text-center text-sm text-muted-foreground">
              Total Cost = BOM Cost + (Total Hours × Hourly Rate)
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Budget & Profitability */}
      <Card>
        <CardHeader>
          <CardTitle>Budget & Profitability Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Estimated Budget</p>
                <p className="text-xl font-bold">{formatCurrency(projectBudget)}</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Actual Cost</p>
                <p className="text-xl font-bold">{formatCurrency(totalProjectCost)}</p>
              </div>
              <div className={`text-center p-4 rounded-lg ${isProfit ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="flex items-center justify-center gap-2">
                  {isProfit ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                  <p className="text-sm text-muted-foreground">
                    {isProfit ? 'Profit' : 'Loss'}
                  </p>
                </div>
                <p className={`text-xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(Math.abs(profitOrLoss))}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Budget Utilization</span>
                <span className="text-sm font-semibold">{budgetUtilization.toFixed(1)}%</span>
              </div>
              <Progress 
                value={Math.min(budgetUtilization, 100)} 
                className="h-2" 
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>₹0</span>
                <span>{formatCurrency(projectBudget)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Project Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Additional Project Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-primary" />
                <p className="text-sm text-muted-foreground">Cost per Hour</p>
              </div>
              <p className="text-lg font-bold">₹{hourlyRate}</p>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Material vs Engineer</p>
              <p className="text-lg font-bold">
                {((bomCost / totalProjectCost) * 100).toFixed(0)}% / {((totalEngineerCost / totalProjectCost) * 100).toFixed(0)}%
              </p>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Profit Margin</p>
              <p className={`text-lg font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                {((profitOrLoss / projectBudget) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Cost Efficiency</p>
              <Badge variant={budgetUtilization <= 90 ? "default" : budgetUtilization <= 100 ? "secondary" : "destructive"}>
                {budgetUtilization <= 90 ? "Excellent" : budgetUtilization <= 100 ? "Good" : "Over Budget"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export Options */}
      <Card>
        <CardHeader>
          <CardTitle>Export & Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Button className="flex-1">
              <FileDown className="h-4 w-4 mr-2" />
              Export Cost Report (PDF)
            </Button>
            <Button variant="outline" className="flex-1">
              <FileDown className="h-4 w-4 mr-2" />
              Export Data (CSV)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CostCalculationTab;